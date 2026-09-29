import 'package:flutter/material.dart';

import '../core/db.dart';
import '../core/sync.dart';
import '../core/theme.dart';
import '../models/models.dart';

/// The money view: what came in today, what went back to the shop, and what
/// the field user is still holding. Reads only local SQLite, so it renders
/// instantly whether or not there is a connection.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<_DashboardData> _future = _load();

  Future<_DashboardData> _load() async {
    final db = Db.i;
    final now = DateTime.now();
    return _DashboardData(
      totals: await db.totalsFor(now),
      movements:
          await db.movements(from: DateTime(now.year, now.month, now.day)),
      pending: await db.pendingCount(),
    );
  }

  Future<void> _sync() async {
    await Sync.tryNow();
    if (!mounted) return;
    setState(() => _future = _load());
    final msg = Sync.status.value.message;
    if (msg.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Today'),
        actions: [
          ValueListenableBuilder<SyncStatus>(
            valueListenable: Sync.status,
            builder: (context, s, _) => IconButton(
              tooltip: 'Sync now',
              onPressed: s.busy ? null : _sync,
              icon: s.busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.sync),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _sync,
        child: FutureBuilder<_DashboardData>(
          future: _future,
          builder: (context, snap) {
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final d = snap.data!;
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                if (d.pending > 0) _pendingBanner(d.pending),
                Row(children: [
                  Expanded(
                    child: _MoneyCard(
                      label: 'Collected',
                      amount: d.totals.collections,
                      color: moneyGreen,
                      icon: Icons.arrow_downward,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _MoneyCard(
                      label: 'Handed over',
                      amount: d.totals.handovers,
                      color: moneyRed,
                      icon: Icons.arrow_upward,
                    ),
                  ),
                ]),
                const SizedBox(height: 12),
                _MoneyCard(
                  label: 'Cash in hand',
                  amount: d.totals.cashInHand,
                  color: brandBlue,
                  icon: Icons.account_balance_wallet,
                  large: true,
                ),
                const SizedBox(height: 24),
                Text("Today's movements",
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                if (d.movements.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 28),
                    child: Center(
                      child: Text('Nothing recorded yet today.',
                          style: TextStyle(color: Color(0xFF7A838F))),
                    ),
                  )
                else
                  ...d.movements.map(_movementTile),
              ],
            );
          },
        ),
      ),
    );
  }


  Widget _pendingBanner(int count) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF4E0),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(children: [
          const Icon(Icons.cloud_upload_outlined,
              size: 20, color: Color(0xFFB26A00)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '$count waiting to sync. Saved on this phone.',
              style: const TextStyle(color: Color(0xFF8A5200), fontSize: 13),
            ),
          ),
        ]),
      );

  Widget _movementTile(CashMovement m) => Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          dense: true,
          leading: CircleAvatar(
            radius: 18,
            backgroundColor: m.kind == MovementKind.handover
                ? const Color(0xFFFDE7E7)
                : const Color(0xFFE6F4EC),
            child: Icon(
              switch (m.kind) {
                MovementKind.collection => Icons.arrow_downward,
                MovementKind.handover => Icons.arrow_upward,
                MovementKind.adjustment => Icons.tune,
              },
              size: 18,
              color: m.kind == MovementKind.handover ? moneyRed : moneyGreen,
            ),
          ),
          title: Text(
            m.customerName.isEmpty ? m.kind.label : m.customerName,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          ),
          subtitle: Text(
            [
              m.kind.label,
              if (m.note.isNotEmpty) m.note,
              if (!m.synced) 'not synced',
            ].join(' • '),
            style: const TextStyle(fontSize: 12, color: Color(0xFF7A838F)),
          ),
          trailing: Text(
            moneyShort(m.amount),
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: m.kind == MovementKind.handover ? moneyRed : moneyGreen,
            ),
          ),
        ),
      );
}

class _MoneyCard extends StatelessWidget {
  const _MoneyCard({
    required this.label,
    required this.amount,
    required this.color,
    required this.icon,
    this.large = false,
  });

  final String label;
  final double amount;
  final Color color;
  final IconData icon;
  final bool large;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(large ? 18 : 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Expanded(
                child: Text(label,
                    style: const TextStyle(
                        fontSize: 12.5,
                        color: Color(0xFF5A6472),
                        fontWeight: FontWeight.w600)),
              ),
            ]),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                money(amount),
                style: TextStyle(
                  fontSize: large ? 28 : 19,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardData {
  const _DashboardData({
    required this.totals,
    required this.movements,
    required this.pending,
  });

  final CashMovementTotals totals;
  final List<CashMovement> movements;
  final int pending;
}
