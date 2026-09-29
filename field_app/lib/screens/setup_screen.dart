import 'package:flutter/material.dart';

import '../app.dart';
import '../core/api.dart';
import '../core/settings.dart';
import '../core/sync.dart';
import '../core/theme.dart';

/// First-run screen: point the app at the shop server and exchange a one-time
/// pairing code for a permanent device token. No account, no password.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  late final TextEditingController _url =
      TextEditingController(text: settings.server);
  late final TextEditingController _code = TextEditingController();
  late final TextEditingController _name =
      TextEditingController(text: settings.deviceName);

  bool _busy = false;
  String? _error;

  Future<void> _pair() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await settings.setServer(_url.text);
      final name =
          _name.text.trim().isEmpty ? 'Field phone' : _name.text.trim();
      await settings.setDeviceName(name);
      await api.pair(_code.text, name);

      // Pull the customer list straight away so the app is useful offline
      // from the first moment, then hand over to the dashboard.
      await Sync.tryNow();
      if (!mounted) return;
      markPaired();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not pair. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _url.dispose();
    _code.dispose();
    _name.dispose();
    super.dispose();
  }


  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                height: 60,
                width: 60,
                decoration: BoxDecoration(
                    color: brandBlue,
                    borderRadius: BorderRadius.circular(16)),
                alignment: Alignment.center,
                child: const Text('LF',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.bold)),
              ),
              const SizedBox(height: 18),
              Text('Lubric Field',
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text(
                'Record collections, hand over cash and book stock. '
                'Works without internet.',
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: const Color(0xFF5A6472)),
              ),
              const SizedBox(height: 26),
              _label('Server URL'),
              TextField(
                controller: _url,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(
                    hintText: 'http://72.61.115.120:9000'),
              ),
              const SizedBox(height: 14),
              _label('Pairing code'),
              TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                maxLength: 8,
                style: const TextStyle(
                    letterSpacing: 4,
                    fontWeight: FontWeight.w600,
                    fontSize: 18),
                decoration: const InputDecoration(
                    hintText: 'e.g. 90108629', counterText: ''),
              ),
              const SizedBox(height: 14),
              _label('This device is called'),
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration:
                    const InputDecoration(hintText: "Kashif's phone"),
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                _errorBox(_error!),
              ],
              const SizedBox(height: 22),
              _pairButton(),
              const SizedBox(height: 16),
              Text(
                'Get the code from the shop: on the server run\n'
                'node pair.js mobile "Kashif phone"',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 12, color: Color(0xFF7A838F), height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The submit button's enabled state is driven directly by the two text
  /// controllers.
  ///
  /// A `TextEditingController` changes do NOT rebuild the widget that reads
  /// `controller.text` inside `build()` - so computing `canSubmit` in `build()`
  /// leaves the button permanently disabled after the first frame. Listeners
  /// on the controllers rebuild exactly this subtree on every keystroke, which
  /// is both correct and cheaper than calling setState for each character.
  Widget _pairButton() {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: _code,
      builder: (context, _, __) => ValueListenableBuilder<TextEditingValue>(
        valueListenable: _url,
        builder: (context, _, __) {
          final canSubmit = !_busy &&
              _url.text.trim().isNotEmpty &&
              _code.text.trim().isNotEmpty;
          return FilledButton(
            onPressed: canSubmit ? _pair : null,
            child: Text(_busy ? 'Pairing…' : 'Pair this device'),
          );
        },
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6, left: 2),
        child: Text(text,
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Color(0xFF444C57))),
      );

  Widget _errorBox(String message) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: const Color(0xFFFDE7E7),
            borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          const Icon(Icons.error_outline, color: moneyRed, size: 20),
          const SizedBox(width: 8),
          Expanded(
              child: Text(message, style: const TextStyle(color: moneyRed))),
        ]),
      );
}
