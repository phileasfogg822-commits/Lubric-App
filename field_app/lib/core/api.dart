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

  /// Is this device's token still accepted, and what does the shop see?
  ///
  /// The cheapest possible round trip, so the diagnostics screen can tell
  /// "the phone cannot reach the shop" apart from "the shop does not know this
  /// device any more" - both of which otherwise read as "cannot sync".
  Future<PingResult> ping() async {
    try {
      final res = await _dio.get<Object?>(url('/api/v1/ping'), options: _authed);
      return PingResult.fromJson(Map<String, dynamic>.from(res.data as Map));
    } on DioException catch (e) {
      throw ApiException(_explain(e));
    }
  }

  /// Clear the shop's "please sync" note once we have actually synced.
  ///
  /// The server decides whether to clear it, from its own record of when this
  /// device last synced - the phone sends no timestamp, because a round-tripped
  /// one loses the microseconds Postgres stores and never compares equal.
  /// Best effort by design: failing to acknowledge must never turn a successful
  /// sync into an error, it just leaves the note standing.
  Future<void> ackSyncRequest() async {
    try {
      await _dio.post<Object?>(
        url('/api/v1/sync-request/ack'),
        options: _authed,
      );
    } on DioException {
      // Ignored on purpose - see above.
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

/// The shop's answer to "are you still talking to me, and do you know me?".
class PingResult {
  PingResult({
    required this.ok,
    required this.serverTime,
    required this.deviceName,
    required this.lastSyncAt,
    required this.counts,
  });

  final bool ok;
  final String serverTime;
  final String deviceName;
  final String? lastSyncAt;
  final Map<String, int> counts;

  factory PingResult.fromJson(Map<String, dynamic> json) {
    final device = Map<String, dynamic>.from(
        (json['device'] as Map?) ?? const <String, dynamic>{});
    final raw = Map<String, dynamic>.from(
        (json['counts'] as Map?) ?? const <String, dynamic>{});
    return PingResult(
      ok: json['ok'] == true,
      serverTime: (json['server_time'] ?? '').toString(),
      deviceName: (device['name'] ?? '').toString(),
      lastSyncAt: device['last_sync_at']?.toString(),
      counts: {
        for (final e in raw.entries)
          e.key: (e.value as num?)?.toInt() ?? 0,
      },
    );
  }
}

class SyncPull {
  SyncPull({
    required this.cursor,
    required this.customers,
    required this.reservations,
    this.syncRequestedAt,
  });

  final int cursor;
  final List<Map<String, dynamic>> customers;
  final List<Map<String, dynamic>> reservations;

  /// When the shop last asked this phone to sync, if it is asking.
  final String? syncRequestedAt;

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
      syncRequestedAt: json['sync_requested_at']?.toString(),
    );
  }
}
