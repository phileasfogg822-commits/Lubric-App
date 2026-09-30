import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/models.dart';

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
      version: 1,
      onCreate: (d, _) => _createSchema(d),
    );
    return _instance = Db._(db);
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

    await b.commit(noResult: true);
  }
  // -- cash movements ------------------------------------------------------

  /// Save a movement and queue it for the server in one transaction, so a row
  /// can never exist locally without also being queued for upload.
  Future<void> saveMovement(CashMovement m) async {
    await _db.transaction((txn) async {
      await txn.insert(
        'cash_movements',
        {
          'uuid': m.uuid,
          'kind': m.kind.name,
          'amount': m.amount,
          'customer_uuid': m.customerUuid,
          'customer_name': m.customerName,
          'note': m.note,
          'occurred_at': m.occurredAt.toIso8601String(),
          'synced': 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await _enqueue(txn, 'cash_movements', m.uuid, {
        'uuid': m.uuid,
        'kind': m.kind.name,
        'amount': m.amount,
        'customer_name': m.customerName,
        'note': m.note,
        'occurred_at': m.occurredAt.toUtc().toIso8601String(),
        'origin': 'mobile',
      });
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
      await _enqueue(txn, 'reservations', r.uuid, {
        'uuid': r.uuid,
        'customer_name': r.customerName,
        'items_json': r.itemsJson,
        'amount': r.amount,
        'status': r.status.name,
        'note': r.note,
        'origin': 'mobile',
      });
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
    await txn.insert('outbox', {
      'table_name': table,
      'row_uuid': uuid,
      'op': 'upsert',
      'payload': _encode(payload),
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

  /// Rows the server refused leave the retry queue so they cannot block the
  /// rows behind them; the count is surfaced to the user instead.
  Future<void> markRejected(String table, String uuid) async {
    await _db.delete('outbox',
        where: 'table_name = ? AND row_uuid = ?', whereArgs: [table, uuid]);
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

  /// Minimal JSON encoder. Outbox payloads are flat maps of string/number/bool
  /// values, so this avoids pulling a JSON package into the app.
  static String _encode(Map<String, dynamic> m) {
    final parts = <String>[];
    m.forEach((k, v) {
      final value =
          v == null ? 'null' : (v is num || v is bool) ? '$v' : _escape('$v');
      parts.add('"${_escape(k)}":$value');
    });
    return '{${parts.join(',')}}';
  }

  static String _escape(String s) => s
      .replaceAll(r'\', r'\\')
      .replaceAll('"', r'\"')
      .replaceAll('\n', r'\n')
      .replaceAll('\r', r'\r');
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