import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/db.dart';
import '../core/theme.dart';
import '../core/uuid.dart';
import '../models/models.dart';

/// Record a collection, a cash handover to the shop, or an adjustment.
/// Writes straight to local SQLite and queues it for sync, so this screen
/// never needs a connection.
class RecordScreen extends StatefulWidget {
  const RecordScreen({super.key});

  @override
  State<RecordScreen> createState() => _RecordScreenState();
}

class _RecordScreenState extends State<RecordScreen> {
  MovementKind _kind = MovementKind.collection;
  final _amount = TextEditingController();
  final _note = TextEditingController();
  Customer? _customer;
  DateTime _when = DateTime.now();
  bool _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0) {
      _toast('Enter an amount greater than zero.');
      return;
    }
    setState(() => _saving = true);
    try {
      await Db.i.saveMovement(CashMovement(
        uuid: newUuid(),
        kind: _kind,
        amount: amount,
        customerUuid: _customer?.uuid ?? '',
        customerName: _customer?.name ?? '',
        note: _note.text.trim(),
        occurredAt: _when,
      ));
    } catch (e) {
      // Never let a failed write look like a slow one. The old code let the
      // exception escape across the async gap: the button stayed on "Saving…"
      // forever, nothing was recorded, and the user was told nothing at all.
      // A field user needs to know their collection was NOT saved.
      if (!mounted) return;
      setState(() => _saving = false);
      _toast('Could not save: ${_short(e)}');
      return;
    }
    if (!mounted) return;
    setState(() {
      _saving = false;
      _amount.clear();
      _note.clear();
      _customer = null;
      _when = DateTime.now();
    });
    _toast('${_kind.label} saved. It will sync automatically.');
  }

  /// The useful half of a database error. "no such column: taken_by_name" is
  /// exactly what a field user needs to see, and exactly what they were not.
  String _short(Object e) {
    final s = e.toString().replaceFirst(RegExp(r'^\w*Exception:\s*'), '');
    return s.length > 140 ? '${s.substring(0, 140)}…' : s;
  }

  void _toast(String m) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _when,
      firstDate: DateTime.now().subtract(const Duration(days: 90)),
      lastDate: DateTime.now(),
    );
    if (date == null) return;
    setState(() => _when = DateTime(
        date.year, date.month, date.day, _when.hour, _when.minute));
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 6, left: 2),
        child: Text(t,
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Color(0xFF444C57))),
      );
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Record')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          SegmentedButton<MovementKind>(
            segments: const [
              ButtonSegment(
                  value: MovementKind.collection,
                  label: Text('Collect'),
                  icon: Icon(Icons.arrow_downward)),
              ButtonSegment(
                  value: MovementKind.handover,
                  label: Text('Hand over'),
                  icon: Icon(Icons.arrow_upward)),
              ButtonSegment(
                  value: MovementKind.adjustment,
                  label: Text('Adjust'),
                  icon: Icon(Icons.tune)),
            ],
            selected: {_kind},
            onSelectionChanged: (s) => setState(() => _kind = s.first),
          ),
          const SizedBox(height: 20),
          _label('Amount (PKR)'),
          TextField(
            controller: _amount,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
            ],
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
            decoration: const InputDecoration(hintText: '0'),
          ),
          const SizedBox(height: 18),
          if (_kind == MovementKind.collection) ...[
            _label('Customer'),
            _CustomerPicker(
              selected: _customer,
              onChanged: (c) => setState(() => _customer = c),
            ),
            const SizedBox(height: 18),
          ],
          _label('Note'),
          TextField(
            controller: _note,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: switch (_kind) {
                MovementKind.collection => 'Invoice or receipt number',
                MovementKind.handover => 'Received by',
                MovementKind.adjustment => 'Reason',
              },
            ),
          ),
          const SizedBox(height: 18),
          _label('When'),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.event),
            label: Text(dateTimeLabel(_when)),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(
                _saving ? 'Saving...' : 'Save ${_kind.label.toLowerCase()}'),
          ),
        ],
      ),
    );
  }
}
/// Type-ahead over the customer list cached from the shop system. Works fully
/// offline - the list is pulled during sync.
class _CustomerPicker extends StatefulWidget {
  const _CustomerPicker({required this.selected, required this.onChanged});

  final Customer? selected;
  final ValueChanged<Customer?> onChanged;

  @override
  State<_CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<_CustomerPicker> {
  List<Customer> _hits = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    _search('');
  }

  void _search(String q) {
    _query = q;
    Db.i.customers(search: q).then((rows) {
      if (mounted) setState(() => _hits = rows.take(20).toList());
    });
  }

  @override
  Widget build(BuildContext context) {
    final chosen = widget.selected;
    if (chosen != null) {
      return InputDecorator(
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.person),
          suffixIcon: IconButton(
            icon: const Icon(Icons.clear),
            onPressed: () => widget.onChanged(null),
          ),
        ),
        child: Text(chosen.name.isEmpty ? chosen.phone : chosen.name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          onChanged: _search,
          decoration: const InputDecoration(
            hintText: 'Search name or phone',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        if (_hits.isNotEmpty) ...[
          const SizedBox(height: 6),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: _hits
                  .map((c) => ListTile(
                        dense: true,
                        title: Text(c.name.isEmpty ? c.phone : c.name),
                        subtitle: c.owesMoney
                            ? Text('owes ${money(c.creditBalance)}',
                                style: const TextStyle(
                                    color: moneyRed, fontSize: 12))
                            : null,
                        trailing: c.phone.isEmpty
                            ? null
                            : const Icon(Icons.call, size: 18),
                        onTap: () => widget.onChanged(c),
                      ))
                  .toList(),
            ),
          ),
        ] else if (_query.isNotEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 8, left: 4),
            child: Text('No matching customer.',
                style: TextStyle(fontSize: 12, color: Color(0xFF7A838F))),
          ),
      ],
    );
  }
}