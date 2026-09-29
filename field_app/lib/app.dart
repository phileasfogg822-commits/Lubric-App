import 'package:flutter/material.dart';

import 'core/settings.dart';
import 'core/theme.dart';
import 'screens/dashboard_screen.dart';
import 'screens/home_shell.dart';
import 'screens/record_screen.dart';
import 'screens/reservations_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/setup_screen.dart';

class LubricFieldApp extends StatelessWidget {
  const LubricFieldApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lubric Field',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const _Root(),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    // Pairing state is read once here; the shell is rebuilt after pairing via
    // a ValueListenable so we don't need a state-management package.
    return ValueListenableBuilder<bool>(
      valueListenable: _pairing,
      builder: (context, paired, _) =>
          paired ? const HomeShell() : const SetupScreen(),
    );
  }
}

/// Flipped to true once the device is paired, so the app can swap from the
/// setup screen to the dashboard without a restart.
final ValueNotifier<bool> _pairing =
    ValueNotifier<bool>(settings.isPaired);

void markPaired() => _pairing.value = true;

/// Exposed for the tab bar so each tab can be constructed lazily.
List<Widget> buildTabs() => const [
      DashboardScreen(),
      RecordScreen(),
      ReservationsScreen(),
      SettingsScreen(),
    ];
