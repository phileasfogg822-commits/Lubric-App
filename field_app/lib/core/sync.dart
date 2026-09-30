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
    this.skipped = 0,
  });

  final int pushed;
  final int pulled;
  final int rejected;
  final int queued;

  /// Rows the server sent that would not save on this phone.
  final int skipped;
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
      PushResult result;
      try {
        result = await api.push(queued
            .map((r) => OutboxChange(
                  table: r.table,
                  uuid: r.uuid,
                  op: r.op,
                  row: jsonDecode(r.payload) as Map<String, dynamic>,
                ))
            .toList());
      } catch (e) {
        // Upload is the part that must never be lost, so say so plainly.
        throw ApiException('Could not upload your work: ${_why(e)}');
      }

      pushed = result.applied.length;
      rejected = result.rejected.length;
      for (final row in queued) {
        if (result.applied.contains(row.uuid)) {
          await db.markSynced(row.table, row.uuid);
        }
      }
      // Rejected rows are recorded, not discarded, so a refused collection
      // stays visible and can be retried. A uuid the server mentions but we did
      // not send is ignored rather than crashing the whole sync on a lookup
      // miss.
      for (final entry in result.rejected.entries) {
        final match = queued.where((r) => r.uuid == entry.key);
        if (match.isEmpty) continue;
        await db.markRejected(match.first.table, match.first.uuid, entry.value);
      }
    }

    // ── pull ──
    status.value = SyncStatus(phase: SyncPhase.pulling, pushed: pushed);
    final cursor = await db.pullCursor();
    final SyncPull incoming;
    try {
      incoming = await api.pull(cursor);
    } catch (e) {
      throw ApiException('Could not download from the shop: ${_why(e)}');
    }

    // One bad row must not abandon the whole download: each is stored on its
    // own and the first failure is reported, instead of the batch dying with the
    // cursor stuck so it replays the same data and fails identically forever.
    String? firstError;
    int skipped = 0;
    for (final r in incoming.customers) {
      try {
        await db.applyRemoteCustomer(r);
        pulled++;
      } catch (e) {
        skipped++;
        firstError ??= 'a customer row - ${_why(e)}';
      }
    }
    for (final r in incoming.reservations) {
      try {
        await db.applyRemoteReservation(r);
        pulled++;
      } catch (e) {
        skipped++;
        firstError ??= 'a reservation row - ${_why(e)}';
      }
    }

    // Only move past what was actually stored.
    await db.setPullCursor(skipped > 0 ? 0 : incoming.cursor);
    await settings.setLastSync(DateTime.now());

    // Tell the shop we did what it asked. Done after the work, so the note is
    // cleared by a real sync rather than an attempt.
    final asked = incoming.syncRequestedAt;
    if (asked != null && asked.isNotEmpty) {
      await api.ackSyncRequest();
    }

    final remaining = await db.pendingCount();
    final message = skipped > 0
        ? 'Downloaded, but $skipped row(s) would not save on this phone. '
            'First problem: ${firstError}'
        : (rejected > 0 ? '$rejected row(s) were refused by the server.' : '');
    status.value = SyncStatus(
      pushed: pushed,
      pulled: pulled,
      rejected: rejected,
      message: message,
    );
    await settings.setLastError(message);
    return SyncSummary(
      pushed: pushed,
      pulled: pulled,
      rejected: rejected,
      queued: remaining,
      skipped: skipped,
    );
  }

  /// The human-readable part of any error, including the plain database ones
  /// that used to be flattened into a generic "Sync failed.".
  static String _why(Object e) {
    if (e is ApiException) return e.message;
    final s = e.toString();
    return s.length > 160 ? '${s.substring(0, 160)}…' : s;
  }

  /// Fire-and-forget sync used by the automatic timer and pull-to-refresh.
  /// Never throws - failures are recorded in [status] instead.
  static Future<SyncSummary?> tryNow() async {
    try {
      return await now();
    } catch (e) {
      final msg = e is ApiException ? e.message : 'Sync failed: ${_why(e)}';
      status.value = SyncStatus(phase: SyncPhase.failed, message: msg);
      await settings.setLastError(msg);
      return null;
    }
  }
}

final api = Api();
