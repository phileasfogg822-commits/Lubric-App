import 'package:dio/dio.dart';

import 'settings.dart';

/// A failure we can show to the user verbatim - the server sent a message.
class ApiException implements Exception {
  ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Talks to the LubricApp server using the same `/api/v1` protocol the desktop
/// agent uses. Auth is a per-device bearer token obtained once via a pairing
/// code - there are no user accounts on the field app.
class Api {
  Api() : _dio = Dio() {
    _dio.options
      ..connectTimeout = const Duration(seconds: 12)
      ..receiveTimeout = const Duration(seconds: 30)
      ..sendTimeout = const Duration(seconds: 30)
      ..headers['Content-Type'] = 'application/json'
      ..responseType = ResponseType.json;
  }

  final Dio _dio;

  /// Absolute URL for a server-relative path, e.g. `/api/v1/pull`.
  String url(String path) => '${settings.server}$path';

  Options get _authed => Options(
        headers: {'Authorization': 'Bearer ${settings.token}'},
      );

  /// Exchange a one-time pairing code for a long-lived device token.
  Future<void> pair(String code, String name) async {
    if (settings.server.isEmpty) {
      throw ApiException('Enter the server URL first.');
    }
    try {
      final res = await _dio.post<Object?>(
        url('/api/v1/devices/pair'),
        data: {'code': code.trim().toUpperCase(), 'name': name},
      );
      final data = Map<String, dynamic>.from(res.data as Map);
      final token = data['token'] as String?;
      if (token == null || token.isEmpty) {
        throw ApiException('Server did not return a device token.');
      }
      await settings.setToken(token);
    } on DioException catch (e) {
      throw ApiException(_explain(e));
    }
  }

  /// Everything changed since [since] (a server timestamp cursor).
  Future<SyncPull> pull(int since) async {
    try {
      final res = await _dio.get<Object?>(
        url('/api/v1/pull?since=$since'),
        options: _authed,
      );
      return SyncPull.fromJson(Map<String, dynamic>.from(res.data as Map));
    } on DioException catch (e) {
      throw ApiException(_explain(e));
    }
  }

  /// Push queued local changes. Idempotent: the server keys everything by the
  /// client-generated uuid, so a retry after a network drop is safe.
  Future<PushResult> push(List<OutboxChange> changes) async {
    try {
      final res = await _dio.post<Object?>(
        url('/api/v1/push'),
        options: _authed,
        data: {
          'changes': changes
              .map((c) => {'table': c.table, 'uuid': c.uuid, 'op': c.op, 'row': c.row})
              .toList(),
        },
      );
      return PushResult.fromJson(Map<String, dynamic>.from(res.data as Map));
    } on DioException catch (e) {
      throw ApiException(_explain(e));
    }
  }

  /// Turn a transport failure into something a shopkeeper can act on.
  String _explain(DioException e) {
    final type = e.type;
    if (type == DioExceptionType.connectionTimeout ||
        type == DioExceptionType.receiveTimeout ||
        type == DioExceptionType.sendTimeout) {
      return 'Server did not respond. Check the URL and your connection.';
    }
    if (type == DioExceptionType.connectionError) {
      return 'Cannot reach the server. Your work is saved - try syncing later.';
    }
    // The server sends { error: "..." } on 4xx/5xx; prefer that text.
    final data = e.response?.data;
    if (data is Map && data['error'] is String) return data['error'] as String;
    final code = e.response?.statusCode;
    if (code != null) return 'Server error $code.';
    return 'Something went wrong. Please try again.';
  }
}

/// One queued local change waiting to reach the server.
class OutboxChange {
  const OutboxChange({
    required this.table,
    required this.uuid,
    required this.op,
    required this.row,
  });

  final String table;
  final String uuid;
  final String op;
  final Map<String, dynamic> row;
}

class PushResult {
  PushResult({required this.applied, required this.rejected});

  final Set<String> applied;
  final Map<String, String> rejected;

  factory PushResult.fromJson(Map<String, dynamic> json) {
    final applied = <String>{
      for (final item in (json['applied'] as List? ?? const []))
        if (item is Map && item['uuid'] != null) item['uuid'] as String,
    };
    final rejected = <String, String>{};
    for (final item in (json['rejected'] as List? ?? const [])) {
      if (item is Map && item['uuid'] != null) {
        rejected[item['uuid'] as String] =
            (item['error'] ?? 'rejected') as String;
      }
    }
    return PushResult(applied: applied, rejected: rejected);
  }
}

class SyncPull {
  SyncPull({required this.cursor, required this.customers, required this.reservations});

  final int cursor;
  final List<Map<String, dynamic>> customers;
  final List<Map<String, dynamic>> reservations;

  factory SyncPull.fromJson(Map<String, dynamic> json) {
    final changes = Map<String, dynamic>.from(json['changes'] as Map? ?? const {});
    List<Map<String, dynamic>> rows(String key) => [
          for (final r in (changes[key] as List? ?? const []))
            Map<String, dynamic>.from(r as Map),
        ];
    return SyncPull(
      cursor: (json['cursor'] as num?)?.toInt() ??
          DateTime.now().millisecondsSinceEpoch,
      customers: rows('customers'),
      reservations: rows('reservations'),
    );
  }
}
