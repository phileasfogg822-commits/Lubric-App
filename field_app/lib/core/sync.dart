import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'db.dart';
import 'settings.dart';

enum SyncPhase { idle, pushing, pulling, failed }

class SyncStatus {
  const SyncStatus({
    this.phase = SyncPhase.idle,
    this.pushed = 0,
    this.pulled = 0,
    this.rejected = 0,
    this.message = '',
  });

  final SyncPhase phase;
  final int pushed;
  final int pulled;
  final int rejected;
  final String message;

  bool get busy => phase == SyncPhase.pushing || phase == SyncPhase.pulling;
}

class SyncSummary {
  const SyncSummary({
    required this.pushed,
    required this.pulled,
    required this.rejected,
    required this.queued,
  });

  final int pushed;
  final int pulled;
  final int rejected;
  final int queued;
}

/// Push everything queued locally, then pull everything changed on the server.
///
/// Ordering matters: push first so the field user's work is safe on the server
/// before we overwrite local reference data (customers/reservations) with
/// whatever the shop has. Failures are non-fatal - the outbox simply stays put
/// and the next sync retries, which is safe because every row carries a
/// client-generated uuid the server de-duplicates on.
class Sync {
  Sync._();

  static final ValueNotifier<SyncStatus> status =
      ValueNotifier<SyncStatus>(const SyncStatus());

  static Future<SyncSummary> now() async {
    if (!settings.isPaired) {
      throw ApiException('This device is not paired yet.');
    }
    final db = Db.i;
    var pushed = 0;
    var pulled = 0;
    var rejected = 0;

    // ── push ──
    status.value = const SyncStatus(phase: SyncPhase.pushing);
    final queued = await db.pendingOutbox();
    if (queued.isNotEmpty) {
      final result = await api.push(queued
          .map((r) => OutboxChange(
                table: r.table,
                uuid: r.uuid,
                op: r.op,
                row: jsonDecode(r.payload) as Map<String, dynamic>,
              ))
          .toList());

      pushed = result.applied.length;
      rejected = result.rejected.length;
      for (final row in queued) {
        if (result.applied.contains(row.uuid)) {
          await db.markSynced(row.table, row.uuid);
        }
      }
      // Rejected rows are dropped from the retry queue so they cannot block
      // the ones behind them, but the count is surfaced to the user.
      for (final entry in result.rejected.entries) {
        final row = queued.firstWhere((r) => r.uuid == entry.key);
        await db.markRejected(row.table, row.uuid);
      }
    }

    // ── pull ──
    status.value = SyncStatus(phase: SyncPhase.pulling, pushed: pushed);
    final incoming = await api.pull(await db.pullCursor());
    if (incoming.customers.isNotEmpty) {
      await db.applyRemoteCustomers(incoming.customers);
      pulled += incoming.customers.length;
    }
    for (final r in incoming.reservations) {
      await db.applyRemoteReservation(r);
      pulled++;
    }
    await db.setPullCursor(incoming.cursor);
    await settings.setLastSync(DateTime.now());

    final remaining = await db.pendingCount();
    status.value = SyncStatus(
      pushed: pushed,
      pulled: pulled,
      rejected: rejected,
      message: rejected > 0
          ? '$rejected row(s) were refused by the server.'
          : '',
    );
    return SyncSummary(
      pushed: pushed,
      pulled: pulled,
      rejected: rejected,
      queued: remaining,
    );
  }

  /// Fire-and-forget sync used by the automatic timer and pull-to-refresh.
  /// Never throws - failures are recorded in [status] instead.
  static Future<SyncSummary?> tryNow() async {
    try {
      return await now();
    } catch (e) {
      status.value = SyncStatus(
        phase: SyncPhase.failed,
        message: e is ApiException ? e.message : 'Sync failed.',
      );
      return null;
    }
  }
}

final api = Api();
