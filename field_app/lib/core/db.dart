import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/models.dart';
import 'outbox_payload.dart';
import 'settings.dart';

/// Offline-first store. Every write lands here first and is queued in
/// `outbox`; the server is just a replica. Nothing in this file needs a
/// network connection, which is the whole point for field staff.
class Db {
  Db._(this._db);

  final Database _db;
  static Db? _instance;
  static Db get i => _instance!;

  static Future<Db> init() async {
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      p.join(dir, 'lubric_field.db'),
      // Bump this AND add a matching step in _upgrade for every schema change.
      // Without an onUpgrade, an existing install keeps its old tables forever
      // and every query against a new column fails with "no such column", which
      // looks like a code bug rather than a migration that never ran.
      version: 2,
      onCreate: (d, _) => _createSchema(d),
      onUpgrade: _upgrade,
    );
    return _instance = Db._(db);
  }

  /// Bring an existing database up to the current schema.
  ///
  /// Written to be additive and safe to re-run, because a phone that fails to
  /// migrate is a phone that cannot upload its work.
  static Future<void> _upgrade(Database d, int from, int to) async {
    if (from < 2) {
      await d.execute('''CREATE TABLE IF NOT EXISTS sync_failures (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_uuid   TEXT NOT NULL,
        payload    TEXT NOT NULL DEFAULT '',
        error      TEXT NOT NULL DEFAULT '',
        attempts   INTEGER NOT NULL DEFAULT 1,
        failed_at  TEXT NOT NULL
      )''');
      await _rescueUnreadableOutbox(d);
    }
  }

  /// Rebuild outbox payloads that the old string encoder wrote as invalid JSON.
  ///
  /// Rows queued before this upgrade are corrupt on disk and can never be
  /// parsed, so they would sit in the outbox forever, failing every sync. The
  /// data itself is intact in the local tables, so each one is re-encoded from
  /// its own row and the user's collections upload normally instead of having
  /// to be re-entered. Anything that cannot be rebuilt is moved somewhere it
  /// can be seen and retried rather than silently discarded.
  static Future<void> _rescueUnreadableOutbox(Database d) async {
    final List<Map<String, Object?>> rows;
    try {
      rows = await d.query('outbox');
    } catch (_) {
      return; // No outbox yet - a fresh install has nothing to rescue.
    }

    for (final row in rows) {
      final id = row['id'];
      final table = row['table_name'];
      final uuid = row['row_uuid'];
      final payload = row['payload'];
      if (id is! int || table is! String || uuid is! String) continue;
      if (payload is! String) continue;

      var readable = false;
      try {
        jsonDecode(payload);
        readable = true;
      } catch (_) {
        readable = false;
      }
      if (readable) continue;

      Map<String, dynamic>? rebuilt;
      try {
        final local = await d.query(table, where: 'uuid = ?', whereArgs: [uuid], limit: 1);
        if (local.isNotEmpty) rebuilt = OutboxPayload.rebuild(table, local.first);
      } catch (_) {
        rebuilt = null;
      }

      if (rebuilt != null) {
        await d.update(
          'outbox',
          {'payload': OutboxPayload.encode(rebuilt)},
          where: 'id = ?',
          whereArgs: [id],
        );
      } else {
        await d.delete('outbox', where: 'id = ?', whereArgs: [id]);
        await d.insert('sync_failures', {
          'table_name': table,
          'row_uuid': uuid,
          'payload': payload,
          'error': 'This row was saved by an old version of the app in a form '
              'the shop could not read. Open the record and save it again.',
          'attempts': 0,
          'failed_at': DateTime.now().toIso8601String(),
        });
      }
    }
  }


  static Future<void> _createSchema(Database d) async {
    final b = d.batch();

    b.execute('''
      CREATE TABLE cash_movements (
        uuid          TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        amount        REAL NOT NULL DEFAULT 0,
        customer_uuid TEXT DEFAULT '',
        customer_name TEXT DEFAULT '',
        taken_by_name TEXT DEFAULT '',
        note          TEXT DEFAULT '',
        occurred_at   TEXT NOT NULL,
        synced        INTEGER NOT NULL DEFAULT 0
      )''');
    b.execute(
        'CREATE INDEX idx_mov_occurred ON cash_movements(occurred_at DESC)');
    b.execute('CREATE INDEX idx_mov_synced ON cash_movements(synced)');

    b.execute('''
      CREATE TABLE reservations (
        uuid          TEXT PRIMARY KEY,
        customer_name TEXT DEFAULT '',
        items_json    TEXT DEFAULT '[]',
        amount        REAL NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'open',
        note          TEXT DEFAULT '',
        created_at    TEXT NOT NULL,
        synced        INTEGER NOT NULL DEFAULT 0
      )''');
    b.execute('CREATE INDEX idx_res_status ON reservations(status)');

    b.execute('''
      CREATE TABLE customers (
        uuid           TEXT PRIMARY KEY,
        name           TEXT DEFAULT '',
        phone          TEXT DEFAULT '',
        customer_type  TEXT DEFAULT '',
        credit_balance REAL NOT NULL DEFAULT 0,
        synced_at      TEXT
      )''');
    b.execute('CREATE INDEX idx_cust_name ON customers(name COLLATE NOCASE)');

    b.execute('''
      CREATE TABLE accounts (
        uuid      TEXT PRIMARY KEY,
        name      TEXT DEFAULT '',
        type      TEXT DEFAULT 'cash',
        synced_at TEXT
      )''');

    b.execute('''
      CREATE TABLE outbox (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_uuid   TEXT NOT NULL,
        op         TEXT NOT NULL DEFAULT 'upsert',
        payload    TEXT NOT NULL,
        queued_at  TEXT NOT NULL
      )''');

    b.execute(
        'CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

    // Rows the shop refused. They are kept rather than discarded: a rejected
    // collection is still the user's money, and the old behaviour of deleting
    // it from the queue meant it vanished with nothing but a count to show for
    // it. Mirrors the desktop's sync_outbox, which already kept the error.
    b.execute('''CREATE TABLE sync_failures (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_uuid   TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '',
      error      TEXT NOT NULL DEFAULT '',
      attempts   INTEGER NOT NULL DEFAULT 1,
      failed_at  TEXT NOT NULL
    )''');

    await b.commit(noResult: true);
  }
  // -- cash movements ------------------------------------------------------

  /// Save a movement and queue it for the server in one transaction, so a row
  /// can never exist locally without also being queued for upload.
  Future<void> saveMovement(CashMovement m) async {
    // Who is holding the phone right now is a fact about this record, so it is
    // written to the row itself rather than read at sync time - a payment taken
    // by one collector must still say so after the phone changes hands.
    final taker = settings.collectorName;
    await _db.transaction((txn) async {
      await txn.insert(
        'cash_movements',
        {
          'uuid': m.uuid,
          'kind': m.kind.name,
          'amount': m.amount,
          'customer_uuid': m.customerUuid,
          'customer_name': m.customerName,
          'taken_by_name': taker,
          'note': m.note,
          'occurred_at': m.occurredAt.toIso8601String(),
          'synced': 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await _enqueue(
          txn, 'cash_movements', m.uuid, OutboxPayload.movement(m, takenByName: taker));
    });
  }

  Future<List<CashMovement>> movements({DateTime? from, int limit = 100}) async {
    final rows = await _db.query(
      'cash_movements',
      where: from == null ? null : 'occurred_at >= ?',
      whereArgs: [from?.toUtc().toIso8601String()],
      orderBy: 'occurred_at DESC',
      limit: limit,
    );
    return rows.map(CashMovement.fromMap).toList();
  }

  Future<CashMovementTotals> totalsFor(DateTime day) async {
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    final rows = await _db.rawQuery(
      'SELECT kind, COALESCE(SUM(amount),0) AS total FROM cash_movements '
      'WHERE occurred_at >= ? AND occurred_at < ? GROUP BY kind',
      [start.toUtc().toIso8601String(), end.toUtc().toIso8601String()],
    );
    final byKind = <String, double>{
      for (final r in rows) r['kind'] as String: (r['total'] as num).toDouble(),
    };
    return CashMovementTotals(
      collections: byKind['collection'] ?? 0,
      handovers: byKind['handover'] ?? 0,
      adjustments: byKind['adjustment'] ?? 0,
    );
  }
  // -- reservations --------------------------------------------------------

  Future<void> saveReservation(Reservation r) async {
    await _db.transaction((txn) async {
      await txn.insert(
        'reservations',
        {
          'uuid': r.uuid,
          'customer_name': r.customerName,
          'items_json': r.itemsJson,
          'amount': r.amount,
          'status': r.status.name,
          'note': r.note,
          'created_at': r.createdAt.toIso8601String(),
          'synced': 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await _enqueue(txn, 'reservations', r.uuid, OutboxPayload.reservation(r));
    });
  }

  Future<List<Reservation>> reservations() async {
    final rows = await _db.query('reservations', orderBy: 'created_at DESC');
    return rows.map(Reservation.fromMap).toList();
  }

  /// Store one reservation from the shop. Server rows win: the shop is the
  /// source of truth for status (e.g. "fulfilled" once the sale is posted in
  /// the till). Each field is type-checked, because a NULL or a number where a
  /// string is expected is exactly what turns a whole sync into a silent
  /// no-op forever.
  Future<void> applyRemoteReservation(Map<String, dynamic> row) async {
    final uuid = row['uuid'] as String?;
    if (uuid == null || uuid.isEmpty) return;
    String text(String key, [String fallback = '']) =>
        (row[key] ?? fallback) is String ? row[key] as String : fallback;
    await _db.insert(
      'reservations',
      {
        'uuid': uuid,
        'customer_name': text('customer_name'),
        'items_json': text('items_json', '[]'),
        'amount': (row['amount'] as num?)?.toDouble() ?? 0,
        'status': text('status', 'open'),
        'note': text('note'),
        'created_at': text('created_at', DateTime.now().toIso8601String()),
        'synced': 1,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // -- reference data from the shop -----------------------------------------

  /// Store one customer from the shop, on its own.
  ///
  /// Deliberately one row per call rather than a batch: a single row that the
  /// phone cannot accept (a type the SQLite column does not expect, say) then
  /// only loses itself, and the sync can report which row and why instead of
  /// throwing on the whole download and replaying it forever.
  Future<void> applyRemoteCustomer(Map<String, dynamic> r) async {
    final uuid = r['uuid'] as String?;
    if (uuid == null || uuid.isEmpty) return;
    await _db.insert(
      'customers',
      {
        'uuid': uuid,
        'name': (r['name'] ?? '') is String ? r['name'] : '',
        'phone': (r['phone'] ?? '') is String ? r['phone'] : '',
        'customer_type':
            (r['customer_type'] ?? '') is String ? r['customer_type'] : '',
        'credit_balance': (r['credit_balance'] as num?)?.toDouble() ?? 0,
        'synced_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<Customer>> customers({String search = ''}) async {
    final q = search.trim();
    final rows = await _db.query(
      'customers',
      where: q.isEmpty ? null : 'name LIKE ? OR phone LIKE ?',
      whereArgs: q.isEmpty ? null : ['%$q%', '%$q%'],
      orderBy: 'name COLLATE NOCASE',
    );
    return rows.map(Customer.fromMap).toList();
  }
  // -- outbox / sync bookkeeping -------------------------------------------

  Future<void> _enqueue(Transaction txn, String table, String uuid,
      Map<String, dynamic> payload) async {
    // Encoded with jsonEncode, never by hand - see outbox_payload.dart for the
    // hand-rolled encoder this replaced and the six weeks of failed uploads it
    // caused.
    await txn.insert('outbox', {
      'table_name': table,
      'row_uuid': uuid,
      'op': 'upsert',
      'payload': OutboxPayload.encode(payload),
      'queued_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<OutboxRow>> pendingOutbox({int limit = 200}) async {
    final rows = await _db.query('outbox', orderBy: 'id', limit: limit);
    return rows.map(OutboxRow.fromMap).toList();
  }

  Future<int> pendingCount() async =>
      Sqflite.firstIntValue(
          await _db.rawQuery('SELECT COUNT(*) FROM outbox')) ??
      0;

  Future<void> markSynced(String table, String uuid) async {
    await _db.delete('outbox',
        where: 'table_name = ? AND row_uuid = ?', whereArgs: [table, uuid]);
    await _db.update(table, {'synced': 1}, where: 'uuid = ?', whereArgs: [uuid]);
  }

  /// A row the server refused leaves the retry queue, but is RECORDED rather
  /// than deleted.
  ///
  /// It used to be dropped on the floor: the outbox row was deleted and nothing
  /// was written anywhere, so a rejected collection simply disappeared and the
  /// user saw a bare count. The money is theirs; it has to stay visible and be
  /// recoverable. [failedRows] feeds the More screen, [retryFailure] puts one
  /// back in the queue.
  Future<void> markRejected(String table, String uuid, String error) async {
    final rows = await _db.query('outbox',
        where: 'table_name = ? AND row_uuid = ?',
        whereArgs: [table, uuid],
        limit: 1);
    final payload =
        rows.isEmpty ? '' : (rows.first['payload'] as String? ?? '');
    await _db.delete('outbox',
        where: 'table_name = ? AND row_uuid = ?', whereArgs: [table, uuid]);
    await _db.insert('sync_failures', {
      'table_name': table,
      'row_uuid': uuid,
      'payload': payload,
      'error': error,
      'attempts': 1,
      'failed_at': DateTime.now().toIso8601String(),
    });
  }

  /// Rows the shop refused, newest first.
  Future<List<SyncFailure>> failedRows({int limit = 100}) async {
    final rows = await _db.query('sync_failures',
        orderBy: 'failed_at DESC', limit: limit);
    return rows.map(SyncFailure.fromMap).toList();
  }

  Future<int> failedCount() async =>
      Sqflite.firstIntValue(
          await _db.rawQuery('SELECT COUNT(*) FROM sync_failures')) ??
      0;

  /// Put a refused row back in the upload queue and clear the failure.
  Future<void> retryFailure(int id) async {
    final rows =
        await _db.query('sync_failures', where: 'id = ?', whereArgs: [id], limit: 1);
    if (rows.isEmpty) return;
    final row = rows.first;
    final payload = row['payload'] as String? ?? '';
    if (payload.isNotEmpty) {
      await _db.insert('outbox', {
        'table_name': row['table_name'],
        'row_uuid': row['row_uuid'],
        'op': 'upsert',
        'payload': payload,
        'queued_at': DateTime.now().toIso8601String(),
      });
    }
    await _db.delete('sync_failures', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> dismissFailure(int id) async {
    await _db.delete('sync_failures', where: 'id = ?', whereArgs: [id]);
  }

  Future<int> pullCursor() async {
    final r = await _db.query('sync_state',
        where: 'key = ?', whereArgs: ['pull_cursor'], limit: 1);
    if (r.isEmpty) return 0;
    return int.tryParse(r.first['value'] as String) ?? 0;
  }

  Future<void> setPullCursor(int value) async {
    await _db.insert('sync_state', {'key': 'pull_cursor', 'value': '$value'},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }
}

class OutboxRow {
  OutboxRow(this.id, this.table, this.uuid, this.op, this.payload);

  final int id;
  final String table;
  final String uuid;
  final String op;
  final String payload;

  factory OutboxRow.fromMap(Map<String, Object?> m) => OutboxRow(
        m['id'] as int,
        m['table_name'] as String,
        m['row_uuid'] as String,
        m['op'] as String? ?? 'upsert',
        m['payload'] as String,
      );
}

/// A row the shop refused, kept so it can be seen and retried.
class SyncFailure {
  SyncFailure({
    required this.id,
    required this.table,
    required this.uuid,
    required this.error,
    required this.attempts,
    required this.failedAt,
  });

  final int id;
  final String table;
  final String uuid;
  final String error;
  final int attempts;
  final DateTime failedAt;

  /// What the user actually recognises - a collection, a reservation - rather
  /// than the table name.
  String get label => switch (table) {
        'cash_movements' => 'Collection / handover',
        'reservations' => 'Reservation',
        _ => table,
      };

  factory SyncFailure.fromMap(Map<String, Object?> m) => SyncFailure(
        id: m['id'] as int,
        table: (m['table_name'] as String?) ?? '',
        uuid: (m['row_uuid'] as String?) ?? '',
        error: (m['error'] as String?) ?? '',
        attempts: (m['attempts'] as int?) ?? 0,
        failedAt: DateTime.tryParse(m['failed_at'] as String? ?? '') ??
            DateTime.now(),
      );
}