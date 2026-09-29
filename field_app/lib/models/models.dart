/// Plain data classes. Kept dependency-free so the same shapes can be reused
/// by the reports and share layers without pulling in serialisation code.
library;

enum MovementKind {
  collection,
  handover,
  adjustment;

  String get label => switch (this) {
        MovementKind.collection => 'Collection',
        MovementKind.handover => 'Cash handover',
        MovementKind.adjustment => 'Adjustment',
      };

  static MovementKind parse(String raw) => switch (raw) {
        'handover' => MovementKind.handover,
        'adjustment' => MovementKind.adjustment,
        _ => MovementKind.collection,
      };
}

class CashMovement {
  CashMovement({
    required this.uuid,
    required this.kind,
    required this.amount,
    required this.customerUuid,
    required this.customerName,
    required this.note,
    required this.occurredAt,
    this.synced = false,
  });

  final String uuid;
  final MovementKind kind;
  final double amount;
  final String customerUuid;
  final String customerName;
  final String note;
  final DateTime occurredAt;
  final bool synced;

  factory CashMovement.fromMap(Map<String, Object?> m) => CashMovement(
        uuid: m['uuid'] as String,
        kind: MovementKind.parse(m['kind'] as String? ?? 'collection'),
        amount: (m['amount'] as num?)?.toDouble() ?? 0,
        customerUuid: (m['customer_uuid'] as String?) ?? '',
        customerName: (m['customer_name'] as String?) ?? '',
        note: (m['note'] as String?) ?? '',
        occurredAt:
            DateTime.tryParse(m['occurred_at'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        synced: (m['synced'] as int? ?? 0) == 1,
      );
}

class CashMovementTotals {
  const CashMovementTotals({
    required this.collections,
    required this.handovers,
    required this.adjustments,
  });

  final double collections;
  final double handovers;
  final double adjustments;

  /// Money the field user is currently holding: what came in, minus what was
  /// handed over to the shop.
  double get cashInHand => collections - handovers;
}

enum ReservationStatus {
  open,
  fulfilled,
  cancelled;

  String get label => switch (this) {
        ReservationStatus.open => 'Open',
        ReservationStatus.fulfilled => 'Fulfilled',
        ReservationStatus.cancelled => 'Cancelled',
      };

  static ReservationStatus parse(String raw) => switch (raw) {
        'fulfilled' => ReservationStatus.fulfilled,
        'cancelled' => ReservationStatus.cancelled,
        _ => ReservationStatus.open,
      };
}

class Reservation {
  Reservation({
    required this.uuid,
    required this.customerName,
    required this.itemsJson,
    required this.amount,
    required this.status,
    required this.note,
    required this.createdAt,
    this.synced = false,
  });

  final String uuid;
  final String customerName;
  final String itemsJson;
  final double amount;
  final ReservationStatus status;
  final String note;
  final DateTime createdAt;
  final bool synced;

  /// `items_json` is stored exactly as the server sends it (a JSON array of
  /// line items). The UI renders it verbatim rather than re-encoding, so what
  /// the shop sees matches what the field user typed.
  String get itemsLabel {
    final raw = itemsJson.trim();
    if (raw.isEmpty || raw == '[]') return 'No items listed';
    return raw;
  }

  factory Reservation.fromMap(Map<String, Object?> m) => Reservation(
        uuid: m['uuid'] as String,
        customerName: (m['customer_name'] as String?) ?? '',
        itemsJson: (m['items_json'] as String?) ?? '[]',
        amount: (m['amount'] as num?)?.toDouble() ?? 0,
        status: ReservationStatus.parse(m['status'] as String? ?? 'open'),
        note: (m['note'] as String?) ?? '',
        createdAt:
            DateTime.tryParse(m['created_at'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        synced: (m['synced'] as int? ?? 0) == 1,
      );
}

class Customer {
  Customer({
    required this.uuid,
    required this.name,
    required this.phone,
    required this.customerType,
    required this.creditBalance,
  });

  final String uuid;
  final String name;
  final String phone;
  final String customerType;
  final double creditBalance;

  bool get owesMoney => creditBalance > 0;

  factory Customer.fromMap(Map<String, Object?> m) => Customer(
        uuid: m['uuid'] as String,
        name: (m['name'] as String?) ?? '',
        phone: (m['phone'] as String?) ?? '',
        customerType: (m['customer_type'] as String?) ?? '',
        creditBalance: (m['credit_balance'] as num?)?.toDouble() ?? 0,
      );
}
