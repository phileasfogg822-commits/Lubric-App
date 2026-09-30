import 'dart:convert';

import '../models/models.dart';

/// The exact JSON the server expects for a queued row, in one place.
///
/// This file exists because of a bug that stopped the field app from ever
/// uploading anything. The payload used to be assembled by a hand-rolled
/// string encoder whose comment claimed it "avoids pulling a JSON package into
/// the app" - but `dart:convert` is part of the Dart SDK and `sync.dart`
/// already imported it, so it bought nothing and it never quoted string
/// values:
///
///     {'kind': 'collection'}  ->  {"kind":collection}
///
/// That is not JSON. `jsonDecode` threw `FormatException: Unexpected character
/// (at character 9)` on the very first field (`uuid`, a string), the push
/// aborted, the outbox never drained, and every retry failed identically - so
/// no collection taken on a phone had EVER reached the shop. The server was
/// healthy throughout, which is why it looked like a connection problem.
///
/// Keeping the payload as a plain map, built by a pure function with no
/// database and no platform dependencies, is what makes it testable in CI
/// without a device. `test/outbox_payload_test.dart` asserts a strict
/// encode/decode round trip for every type below, so this cannot come back.
class OutboxPayload {
  OutboxPayload._();

  /// Marks a row as written in the field, so the shop can tell a collection
  /// taken on a phone from one entered at the counter.
  static const String mobileOrigin = 'mobile';

  /// A collection / handover / adjustment taken on the phone.
  static Map<String, dynamic> movement(CashMovement m) => <String, dynamic>{
        'uuid': m.uuid,
        'kind': m.kind.name,
        'amount': m.amount,
        'customer_name': m.customerName,
        'note': m.note,
        'occurred_at': m.occurredAt.toUtc().toIso8601String(),
        'origin': mobileOrigin,
      };

  /// A reservation taken on the phone.
  static Map<String, dynamic> reservation(Reservation r) => <String, dynamic>{
        'uuid': r.uuid,
        'customer_name': r.customerName,
        'items_json': r.itemsJson,
        'amount': r.amount,
        'status': r.status.name,
        'note': r.note,
        'origin': mobileOrigin,
      };

  /// The outbox column value. Strict RFC 8259 JSON - the server parses this
  /// with `JSON.parse` and the phone re-parses it with `jsonDecode`.
  static String encode(Map<String, dynamic> payload) => jsonEncode(payload);

  /// Rebuild a queued payload from the local row that holds the same data.
  ///
  /// Rows queued by the broken encoder are already invalid on disk, so fixing
  /// the encoder alone would leave a field user's collections stuck forever.
  /// Nothing is actually lost, though: every queued row is also stored in full
  /// in its local table, so the payload can be regenerated exactly. The v1 to
  /// v2 migration calls this for every unreadable outbox row.
  ///
  /// Returns null when the row carries no usable identity, which means there is
  /// nothing worth uploading.
  static Map<String, dynamic>? rebuild(String table, Map<String, Object?> row) {
    String text(String key) {
      final v = row[key];
      return v is String ? v : '';
    }

    num number(String key) {
      final v = row[key];
      if (v is num) return v;
      // Recovering from a hand-edited or oddly-typed row, a numeric string is
      // still worth reading - returning 0 instead would silently zero a
      // collection the shop is owed.
      if (v is String) return num.tryParse(v) ?? 0;
      return 0;
    }

    // Timestamps are queued in UTC with a zone marker, so a local string read
    // back out of SQLite has to be converted rather than passed through.
    String utc(String key, DateTime fallback) {
      final parsed = DateTime.tryParse(text(key));
      return (parsed ?? fallback).toUtc().toIso8601String();
    }

    final uuid = text('uuid');
    if (uuid.isEmpty) return null;

    switch (table) {
      case 'cash_movements':
        return <String, dynamic>{
          'uuid': uuid,
          'kind': text('kind').isEmpty ? 'collection' : text('kind'),
          'amount': number('amount'),
          'customer_name': text('customer_name'),
          'note': text('note'),
          'occurred_at': utc('occurred_at', DateTime.now()),
          'origin': mobileOrigin,
        };
      case 'reservations':
        return <String, dynamic>{
          'uuid': uuid,
          'customer_name': text('customer_name'),
          'items_json': text('items_json').isEmpty ? '[]' : text('items_json'),
          'amount': number('amount'),
          'status': text('status').isEmpty ? 'open' : text('status'),
          'note': text('note'),
          'origin': mobileOrigin,
        };
      default:
        return null;
    }
  }
}
