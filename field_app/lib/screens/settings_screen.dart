import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../app.dart';
import '../core/api.dart';
import '../core/db.dart';
import '../core/settings.dart';
import '../core/sync.dart';
import '../core/theme.dart';
import 'update_prompt.dart';

/// Device settings, sync status and the manual "check for updates" button -
/// the same control the shop has over the game.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  int _pending = 0;
  String _version = '';
  bool _testing = false;
  List<SyncFailure> _failures = const [];

  @override
  void initState() {
    super.initState();
    _refresh();
    PackageInfo.fromPlatform().then((i) {
      if (mounted) setState(() => _version = i.version);
    });
  }

  Future<void> _refresh() async {
    final n = await Db.i.pendingCount();
    // Rows the shop refused. Shown rather than dropped: a rejected collection
    // is still money the field user is holding, and deleting it from the queue
    // with nothing left behind meant it could quietly disappear.
    final f = await Db.i.failedRows();
    if (mounted) {
      setState(() {
        _pending = n;
        _failures = f;
      });
    }
  }

  Future<void> _retryFailure(int id) async {
    await Db.i.retryFailure(id);
    await _refresh();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Queued to upload again. Tap Sync now.')),
    );
  }

  /// Ask the shop, in one line, whether it still knows this phone. Separates
  /// "no connection" from "the shop does not know this device" from "fine".
  Future<void> _testConnection() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _testing = true);
    String result;
    try {
      final p = await api.ping();
      final counts = p.counts.entries.map((e) => '${e.value} ${e.key}').join(', ');
      result = 'Shop answered.\n'
          'This device: ${p.deviceName.isEmpty ? '(unnamed)' : p.deviceName}\n'
          'Shop sees: $counts';
    } catch (e) {
      result = 'Could not reach the shop: ${e is ApiException ? e.message : e}';
    }
    await _refresh();
    if (!mounted) return;
    setState(() => _testing = false);
    messenger.showSnackBar(
      SnackBar(content: Text(result), duration: const Duration(seconds: 7)),
    );
  }

  Future<void> _sync() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() {});
    final s = await Sync.tryNow();
    await _refresh();
    if (!mounted) return;
    final text = s == null
        ? (Sync.status.value.message.isEmpty
            ? 'Could not reach the server. Your work is saved here.'
            : Sync.status.value.message)
        : 'Synced ${s.pushed} up, ${s.pulled} down.'
            '${s.queued > 0 ? ' ${s.queued} still waiting.' : ''}';
    messenger.showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _unpair() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Unpair this device?'),
        content: const Text(
          'Anything still waiting to sync will stay on this phone, but it '
          'will not reach the shop until you pair again.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Unpair')),
        ],
      ),
    );
    if (ok != true) return;
    await settings.unpair();
    if (mounted) markPaired(); // flips the shell back to the setup screen
  }

  @override
  Widget build(BuildContext context) {
    final last = settings.lastSync;
    final lastError = settings.lastError;
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(settings.deviceName,
                      style: const TextStyle(
                          fontSize: 17, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  _row('Server', settings.server.isEmpty ? 'not set' : settings.server),
                  _row('Device token', settings.tokenHint),
                  _row('Waiting to sync', '$_pending'),
                  _row(
                    'Last sync',
                    last == null
                        ? 'Never'
                        : dateTimeLabel(last),
                  ),
                  _row('App version', _version),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _sync,
            icon: const Icon(Icons.sync),
            label: const Text('Sync now'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _testing ? null : _testConnection,
            icon: _testing
                ? const SizedBox(
                    height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.wifi_tethering),
            label: const Text('Test connection to shop'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(50),
              shape:
                  RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          if (lastError.isNotEmpty) ...[
            const SizedBox(height: 12),
            Card(
              color: const Color(0xFFFDE7E7),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.error_outline,
                          size: 18, color: moneyRed),
                      const SizedBox(width: 6),
                      Text('Last problem',
                          style: TextStyle(
                              fontWeight: FontWeight.bold, color: moneyRed)),
                    ]),
                    const SizedBox(height: 6),
                    Text(lastError,
                        style: const TextStyle(fontSize: 12.5, height: 1.45)),
                  ],
                ),
              ),
            ),
          ],
          if (_failures.isNotEmpty) ...[
            const SizedBox(height: 12),
            Card(
              color: const Color(0xFFFFF4E5),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.priority_high,
                          size: 18, color: Color(0xFFB45309)),
                      const SizedBox(width: 6),
                      Text(
                        '${_failures.length} record(s) the shop refused',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            color: Color(0xFFB45309)),
                      ),
                    ]),
                    const SizedBox(height: 4),
                    const Text(
                      'These are saved here and have NOT been sent. Retry them '
                      'or ask the shop to check them - they will not be lost.',
                      style: TextStyle(fontSize: 12, height: 1.4),
                    ),
                    const SizedBox(height: 8),
                    for (final f in _failures)
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          border: Border(
                            top: BorderSide(color: const Color(0xFFEADFCB)),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(f.label,
                                      style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600)),
                                  Text(f.error,
                                      style: const TextStyle(
                                          fontSize: 11.5,
                                          color: Color(0xFF7A838F),
                                          height: 1.35)),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed: () => _retryFailure(f.id),
                              child: const Text('Retry',
                                  style: TextStyle(fontSize: 12)),
                            ),
                            TextButton(
                              onPressed: () async {
                                await Db.i.dismissFailure(f.id);
                                await _refresh();
                              },
                              child: const Text('Discard',
                                  style: TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => checkNow(context),
            icon: const Icon(Icons.system_update),
            label: const Text('Check for updates'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
          ),
          const SizedBox(height: 24),
          Text('About',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
            child: Text(
              'Lubric Field records collections, cash handovers and '
              'reservations. Everything is saved on this phone first and '
              'uploaded to the shop system when there is a connection.',
              style:
                  TextStyle(fontSize: 12.5, color: Color(0xFF7A838F), height: 1.5),
            ),
          ),
          const SizedBox(height: 20),
          TextButton.icon(
            onPressed: _unpair,
            icon: const Icon(Icons.link_off, size: 18),
            label: const Text('Unpair this device'),
            style: TextButton.styleFrom(foregroundColor: moneyRed),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 130,
              child: Text(label,
                  style: const TextStyle(
                      fontSize: 13, color: Color(0xFF5A6472))),
            ),
            Expanded(
              child: Text(value,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      );
}
