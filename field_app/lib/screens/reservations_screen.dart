import 'package:flutter/material.dart';

import '../core/db.dart';
import '../core/theme.dart';
import '../core/uuid.dart';
import '../models/models.dart';

/// Goods set aside ("booked") for a customer on a route. The shop sees these
/// in its own Reservations screen, so the field user can promise stock without
/// needing the till.
class ReservationsScreen extends StatefulWidget {
  const ReservationsScreen({super.key});

  @override
  State<ReservationsScreen> createState() => _ReservationsScreenState();
}

class _ReservationsScreenState extends State<ReservationsScreen> {
  late Future<List<Reservation>> _future = Db.i.reservations();

  Future<void> _reload() async {
    final rows = await Db.i.reservations();
    if (mounted) setState(() => _future = Future.value(rows));
  }

  Future<void> _add() async {
    final made = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ReservationForm(),
    );
    if (made == true) _reload();
  }

  Future<void> _setStatus(Reservation r, ReservationStatus s) async {
    await Db.i.saveReservation(Reservation(
      uuid: r.uuid,
      customerName: r.customerName,
      itemsJson: r.itemsJson,
      amount: r.amount,
      status: s,
      note: r.note,
      createdAt: r.createdAt,
    ));
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reserve')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('New'),
      ),
      body: FutureBuilder<List<Reservation>>(
        future: _future,
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final rows = snap.data!;
          if (rows.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No reservations yet.\nTap New to book stock for a customer.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF7A838F), height: 1.5),
                ),
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
            itemCount: rows.length,
            itemBuilder: (context, i) => _tile(rows[i]),
          );
        },
      ),
    );
  }
  Widget _tile(Reservation r) {
    final color = switch (r.status) {
      ReservationStatus.open => brandBlue,
      ReservationStatus.fulfilled => moneyGreen,
      ReservationStatus.cancelled => const Color(0xFF7A838F),
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(
                  r.customerName.isEmpty ? 'Walk-in customer' : r.customerName,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 15),
                ),
              ),
              Text(money(r.amount),
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, color: brandBlue)),
            ]),
            const SizedBox(height: 4),
            Text(r.itemsLabel,
                style: const TextStyle(
                    fontSize: 12.5, color: Color(0xFF5A6472), height: 1.4)),
            const SizedBox(height: 8),
            Row(children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(r.status.label,
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: color)),
              ),
              if (!r.synced) ...[
                const SizedBox(width: 8),
                const Text('not synced',
                    style:
                        TextStyle(fontSize: 11, color: Color(0xFFB26A00))),
              ],
              const Spacer(),
              if (r.status == ReservationStatus.open)
                PopupMenuButton<ReservationStatus>(
                  onSelected: (s) => _setStatus(r, s),
                  itemBuilder: (_) => const [
                    PopupMenuItem(
                        value: ReservationStatus.fulfilled,
                        child: Text('Mark fulfilled')),
                    PopupMenuItem(
                        value: ReservationStatus.cancelled,
                        child: Text('Cancel')),
                  ],
                ),
            ]),
          ],
        ),
      ),
    );
  }
}
class _ReservationForm extends StatefulWidget {
  const _ReservationForm();

  @override
  State<_ReservationForm> createState() => _ReservationFormState();
}

class _ReservationFormState extends State<_ReservationForm> {
  final _customer = TextEditingController();
  final _items = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();

  @override
  void dispose() {
    _customer.dispose();
    _items.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text.trim()) ?? 0;
    final desc = _items.text.trim().replaceAll(RegExp('["]'), "'");
    await Db.i.saveReservation(Reservation(
      uuid: newUuid(),
      customerName: _customer.text.trim(),
      // Stored as a one-item array so the shop renders it the same way as a
      // multi-line reservation.
      itemsJson: '[{"desc":"$desc"}]',
      amount: amount,
      status: ReservationStatus.open,
      note: _note.text.trim(),
      createdAt: DateTime.now(),
    ));
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New reservation',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            TextField(
              controller: _customer,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Customer name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _items,
              textCapitalization: TextCapitalization.sentences,
              maxLines: 3,
              decoration:
                  const InputDecoration(hintText: 'What are you booking?'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration:
                  const InputDecoration(hintText: 'Estimated value (PKR)'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              decoration: const InputDecoration(hintText: 'Note (optional)'),
            ),
            const SizedBox(height: 20),
            FilledButton(
                onPressed: _save, child: const Text('Save reservation')),
          ],
        ),
      ),
    );
  }
}