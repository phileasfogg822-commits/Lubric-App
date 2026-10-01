import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lubric_field/core/outbox_payload.dart';
import 'package:lubric_field/models/models.dart';

/// Guards a bug that shipped twice in the same week.
///
/// The local SQLite schema is created by `_createSchema`, which sqflite runs
/// ONLY on a fresh install. A column added there and not to `_upgrade` exists on
/// every new phone and on no upgraded phone, and the failure is delayed and
/// silent: the first INSERT that mentions it throws "no such column", the
/// write is lost, and - before the try/catch that now guards both save paths -
/// the Save button simply spun forever while the user was told nothing.
///
/// This test reads the source and fails if the two drift apart again. It cannot
/// run the real migration without a device, but drift is a source-level
/// property, and this is the only place it can be caught for free.
void main() {
  final fixture = jsonDecode(
    File('test/fixtures/outbox_payloads.json').readAsStringSync(),
  ) as Map<String, dynamic>;

/// Guards the bug that stopped the field app from ever uploading anything.
///
/// `Db` used to build outbox payloads with a hand-rolled string encoder that
/// never quoted a string value, so `{"kind":collection}` was stored and
/// `jsonDecode` then threw `FormatException: Unexpected character (at character
/// 9)` on the very first field. The push aborted, the outbox never drained, and
/// no collection taken on a phone ever reached the shop - while the server
/// looked perfectly healthy, because it was.
void main() {
  final fixture = jsonDecode(
    File('test/fixtures/outbox_payloads.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  CashMovement movementFrom(Map<String, dynamic> row) => CashMovement(
        uuid: row['uuid'] as String,
        kind: MovementKind.parse(row['kind'] as String),
        amount: (row['amount'] as num).toDouble(),
        customerUuid: (row['customer_uuid'] as String?) ?? '',
        customerName: row['customer_name'] as String,
        note: row['note'] as String,
        occurredAt: DateTime.parse(row['occurred_at'] as String),
      );

  // `created_at` lives only in local_row: the payload deliberately omits it
  // (the server stamps it), so the fixture's outgoing row has no such key.
  const fallbackCreated = '2026-09-30T19:21:20.409Z';

  // The payload for a fixture movement, including the collector. routed through
  // one helper so a new required field cannot be silently omitted by one of the
  // call sites below.
  Map<String, dynamic> movementPayload(Map<String, dynamic> row) =>
      OutboxPayload.movement(
        movementFrom(row),
        takenByName: (row['taken_by_name'] as String?) ?? '',
      );

  Reservation reservationFrom(Map<String, dynamic> row) => Reservation(
        uuid: row['uuid'] as String,
        customerName: row['customer_name'] as String,
        itemsJson: row['items_json'] as String,
        amount: (row['amount'] as num).toDouble(),
        status: ReservationStatus.parse(row['status'] as String),
        note: row['note'] as String,
        createdAt:
            DateTime.parse(row['created_at'] as String? ?? fallbackCreated),
      );

  group('local schema cannot drift from the migration path', () {
    final db = File('lib/core/db.dart').readAsStringSync();

    /// Columns the CREATE TABLE block in _createSchema declares.
    Set<String> columnsInCreateSchema(String table) {
      final start = db.indexOf("CREATE TABLE $table (");
      expect(start, isNot(-1), reason: 'could not find CREATE TABLE $table');
      final end = db.indexOf('b.execute(', start);
      final block = db.substring(start, end == -1 ? db.length : end);
      return {
        for (final m in RegExp(r'^\s*(\w+)\s+[A-Z]', multiLine: true)
            .allMatches(block))
          m.group(1)!,
      };
    }

    /// Columns _upgrade patches via _addColumnIfMissing.
    Set<String> columnsAddedByUpgrade() {
      final start = db.indexOf('static Future<void> _upgrade');
      final end = db.indexOf('/// SQLite has no', start);
      final block = db.substring(start, end == -1 ? db.length : end);
      return {
        for (final m in RegExp(r"_addColumnIfMissing\(\s*d,\s*'\w+',\s*'(\w+)'")
            .allMatches(block))
          m.group(1)!,
      };
    }

    test('the schema version is bumped past every migration step', () {
      final version = int.parse(
          RegExp(r'version:\s*(\d+)').firstMatch(db)!.group(1)!);
      final steps = RegExp(r'if \(from < (\d+)\)')
          .allMatches(db)
          .map((m) => int.parse(m.group(1)!))
          .toList();

      expect(steps, isNotEmpty, reason: 'no migration steps found at all');
      for (final s in steps) {
        expect(s, lessThan(version),
            reason: 'migration step "from < $s" can never run - the database '
                'is already at version $version');
      }
      expect(steps.toSet().length, steps.length,
          reason: 'two migration steps share the same version number');
    });

    test('every column saveMovement writes exists after an upgrade', () {
      final start = db.indexOf('Future<void> saveMovement');
      final end = db.indexOf('Future<List<CashMovement>> movements', start);
      final body = db.substring(start, end);

      final written = {
        for (final m in RegExp(r"'(\w+)':").allMatches(body)) m.group(1)!,
      };
      expect(written, isNotEmpty, reason: 'could not read the insert columns');

      final created = columnsInCreateSchema('cash_movements');
      final added = columnsAddedByUpgrade();

      for (final col in written) {
        expect(
          created.contains(col) || added.contains(col),
          isTrue,
          reason: 'saveMovement writes "$col", which is in neither the v1 '
              'schema nor an _upgrade step. On every ALREADY-INSTALLED phone '
              'that INSERT throws "no such column", the record is lost and the '
              'user is shown nothing. Add it to _upgrade.',
        );
      }
    });

    test('every column saveReservation writes exists after an upgrade', () {
      final start = db.indexOf('Future<void> saveReservation');
      final end = db.indexOf('Future<List<Reservation>> reservations', start);
      final body = db.substring(start, end);

      final written = {
        for (final m in RegExp(r"'(\w+)':").allMatches(body)) m.group(1)!,
      };
      final created = columnsInCreateSchema('reservations');
      final added = columnsAddedByUpgrade();

      for (final col in written) {
        expect(created.contains(col) || added.contains(col), isTrue,
            reason: 'saveReservation writes "$col", which no upgrade path adds');
      }
    });

    test('both save paths report a failure instead of failing silently', () {
      // The other half of the same incident: the write threw and nothing caught
      // it, so the button spun forever. Both callers must wrap the save.
      for (final screen in [
        'lib/screens/record_screen.dart',
        'lib/screens/reservations_screen.dart',
      ]) {
        final src = File(screen).readAsStringSync();
        expect(src.contains('catch (e)'), isTrue,
            reason: '$screen can still throw out of a save with nothing to '
                'show the user');
        expect(src.contains('Could not save'), isTrue,
            reason: '$screen must tell the user the record was NOT saved');
      }
    });
  });

  group('outbox payload is strict JSON', () {
    test('a collection round-trips through encode/decode unchanged', () {
      final row = (fixture['movement'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final payload = movementPayload(row);

      final decoded = jsonDecode(OutboxPayload.encode(payload));
      expect(decoded, equals(payload),
          reason: 'the stored payload must be readable by jsonDecode and by '
              'the server JSON.parse');
      expect(decoded, equals(row),
          reason: 'must match the shape the shop server expects');
    });

    test('a reservation round-trips through encode/decode unchanged', () {
      final row = (fixture['reservation'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final payload = OutboxPayload.reservation(reservationFrom(row));

      expect(jsonDecode(OutboxPayload.encode(payload)), equals(row));
    });

    test('does NOT emit the exact bytes that broke sync', () {
      final row = (fixture['movement'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final raw =
          OutboxPayload.encode(movementPayload(row));

      // `:collection` with no quotes is the literal failure reported
      // ("kind":collection). It must be impossible to produce again.
      expect(raw.contains(':collection'), isFalse,
          reason: 'a string value was emitted without quotes: $raw');
      expect(raw, contains('"kind":"collection"'));
      expect(raw, contains('"origin":"mobile"'));
      expect(raw, contains('"uuid":"${row['uuid']}"'));
      // The value of uuid is a string too, and it is the FIRST field - which
      // is why the FormatException reported character 9.
      expect(raw.contains(':e820ccc8'), isFalse,
          reason: 'the uuid value must be quoted, not bare');
    });

    test('the payload the old encoder produced really is unreadable', () {
      final broken = fixture['broken_v1_payload'] as String;
      expect(
        () => jsonDecode(broken),
        throwsA(isA<FormatException>()),
        reason: 'this is the bug the golden test exists to prevent; if this '
            'ever stops throwing, the fixture no longer reproduces the '
            'real failure',
      );
    });

    test('numbers stay numbers', () {
      final row = (fixture['movement'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final decoded =
          jsonDecode(OutboxPayload.encode(movementPayload(row)))
          as Map<String, dynamic>;
      expect(decoded['amount'], isA<num>());
      expect(decoded['amount'] as num, closeTo(600, 1e-9));
    });
  });

  group('hostile text survives', () {
    test('quotes, backslashes, newlines, tabs and unicode round-trip', () {
      final hostile = fixture['hostile_name'] as String;
      final m = CashMovement(
        uuid: 'h-1',
        kind: MovementKind.collection,
        amount: 1.5,
        customerUuid: '',
        customerName: hostile,
        note: 'line1\nline2\r\nline3"quoted" \\ backslash',
        occurredAt: DateTime.utc(2026, 9, 30, 19, 21, 20, 409),
      );

      final payload = OutboxPayload.movement(m);
      final decoded = jsonDecode(OutboxPayload.encode(payload))
          as Map<String, dynamic>;

      expect(decoded['customer_name'], hostile);
      expect(decoded['note'], m.note);
      expect(decoded, equals(payload));
    });

    test('an empty note survives as an empty string, not dropped', () {
      final row = (fixture['reservation'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final r = reservationFrom({...row, 'note': ''});
      final decoded =
          jsonDecode(OutboxPayload.encode(OutboxPayload.reservation(r)))
              as Map<String, dynamic>;
      expect(decoded['note'], '');
      expect(decoded.containsKey('note'), isTrue);
    });
  });

  group('rebuilding a payload stuck from the old encoder', () {
    test('rebuild from the local cash_movements row matches the original',
        () {
      final row = (fixture['movement'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final local = (fixture['movement'] as Map<String, dynamic>)['local_row']
          as Map<String, dynamic>;

      final rebuilt = OutboxPayload.rebuild('cash_movements', local);
      expect(rebuilt, isNotNull,
          reason: 'rows queued before the fix must be recoverable, not lost');
      expect(rebuilt, equals(row));
    });

    test('rebuild from the local reservations row matches the original', () {
      final row = (fixture['reservation'] as Map<String, dynamic>)['row']
          as Map<String, dynamic>;
      final local = (fixture['reservation'] as Map<String, dynamic>)['local_row']
          as Map<String, dynamic>;

      expect(OutboxPayload.rebuild('reservations', local), equals(row));
    });

    test('rebuild refuses a row with no uuid and an unknown table', () {
      expect(OutboxPayload.rebuild('cash_movements', {'kind': 'collection'}),
          isNull);
      expect(OutboxPayload.rebuild('nothing_here', {'uuid': 'x'}), isNull);
    });

    test('rebuild tolerates missing and wrongly-typed columns', () {
      final rebuilt = OutboxPayload.rebuild('cash_movements', {
        'uuid': 'x-1',
        // no kind, no occurred_at, amount arrives as a string
        'amount': '600',
      });
      expect(rebuilt, isNotNull);
      final payload = rebuilt!;
      expect(payload['kind'], 'collection');
      expect(payload['amount'], 600);
      expect(payload['occurred_at'], isA<String>());
      expect(DateTime.tryParse(payload['occurred_at'] as String), isNotNull);
    });
  });
}
