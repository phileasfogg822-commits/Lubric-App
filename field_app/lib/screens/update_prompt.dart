import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/theme.dart';
import '../core/update.dart';

/// Checks the shop server for a newer build of the app.
///
/// The same manifest the shop publishes on the VPS as `updates/android.json`
/// that the Mirror Twins game uses: drop a new APK into `updates/android/`,
/// bump `versionCode`, and every phone picks it up on its next launch.
class UpdatePrompt {
  UpdatePrompt._();

  /// Silent check on app start. Never interrupts the user; it only shows the
  /// dialog when there is genuinely something newer, and a mandatory update is
  /// surfaced because the app may be unusable on that old build.
  static Future<void> checkSilently(BuildContext context) async {
    try {
      final info = await PackageInfo.fromPlatform();
      final check = await UpdateService.i.check();
      if (check == null || !check.isOutdated) return;
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        // A mandatory update cannot be dismissed by tapping outside.
        barrierDismissible: !check.isMandatory,
        builder: (_) => UpdateDialog(check: check),
      );
    } catch (_) {
      // An update check must never be able to stop the app from starting.
    }
  }
}

class UpdateDialog extends StatefulWidget {
  const UpdateDialog({required this.check, super.key});

  final UpdateCheck check;

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  double? _progress;
  String? _error;

  Future<void> _install() async {
    setState(() {
      _progress = 0;
      _error = null;
    });
    try {
      final release = widget.check.available!;
      final apk = await UpdateService.i.download(
        release,
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
      await UpdateService.i.install(apk);
      if (mounted) setState(() => _progress = null);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _progress = null;
        _error = e is StateError
            ? e.message
            : 'Could not install the update. Check your connection.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.check.available!;
    final busy = _progress != null;

    return AlertDialog(
      title: Row(children: [
        const Icon(Icons.system_update, color: brandBlue),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            widget.check.isMandatory ? 'Update required' : 'Update available',
            style: const TextStyle(fontSize: 18),
          ),
        ),
      ]),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${widget.check.currentName}  →  ${r.versionName}',
            style: const TextStyle(
                fontWeight: FontWeight.w600, color: Color(0xFF444C57)),
          ),
          if (r.notes.isNotEmpty) ...[
            const SizedBox(height: 14),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 180),
              child: SingleChildScrollView(
                child: Text(r.notes,
                    style: const TextStyle(
                        fontSize: 13.5, height: 1.45, color: Color(0xFF444C57))),
              ),
            ),
          ],
          if (busy) ...[
            const SizedBox(height: 18),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: _progress,
                minHeight: 8,
              ),
            ),
            const SizedBox(height: 6),
            Text('Downloading… ${(_progress! * 100).round()}%',
                style: const TextStyle(fontSize: 12)),
          ],
          if (_error != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFDE7E7),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_error!,
                  style: const TextStyle(color: moneyRed, fontSize: 13)),
            ),
          ],
        ],
      ),
      actions: [
        if (!widget.check.isMandatory)
          TextButton(
            onPressed: busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Later'),
          ),
        FilledButton(
          onPressed: busy ? null : _install,
          child: Text(busy ? 'Downloading…' : 'Download & install'),
        ),
      ],
    );
  }
}

/// Convenience entry point for the Settings screen's "Check for updates".
Future<void> checkNow(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  final check = await UpdateService.i.check();
  if (check == null) {
    messenger.showSnackBar(const SnackBar(
        content: Text('Could not reach the update server.')));
    return;
  }
  if (!check.isOutdated) {
    messenger.showSnackBar(SnackBar(
        content: Text('You are on the latest version '
            '(${check.currentName}).')));
    return;
  }
  await showDialog<void>(
    context: context,
    builder: (_) => UpdateDialog(check: check),
  );
}
