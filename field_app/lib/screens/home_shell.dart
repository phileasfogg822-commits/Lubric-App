import 'package:flutter/material.dart';

import '../app.dart';
import '../core/db.dart';
import '../core/sync.dart';
import 'update_prompt.dart';

/// The signed-in shell: a bottom navigation bar with the four things a field
/// user does. Screens are kept alive between taps with an IndexedStack so a
/// half-filled form isn't lost when you check another tab.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    // Push anything queued from a previous session, then look for an app
    // update. Neither blocks the UI - the dashboard is usable immediately.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Sync.tryNow();
      UpdatePrompt.checkSilently(context);
    });
  }

  Future<void> _refresh() async {
    final summary = await Sync.tryNow();
    if (!mounted) return;
    if (summary == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(Sync.status.value.message.isEmpty
              ? 'Could not sync. Your work is saved on this phone.'
              : Sync.status.value.message),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final tabs = buildTabs();
    return Scaffold(
      body: IndexedStack(index: _index, children: tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Finances',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_circle_outline),
            selectedIcon: Icon(Icons.add_circle),
            label: 'Record',
          ),
          NavigationDestination(
            icon: Icon(Icons.event_note_outlined),
            selectedIcon: Icon(Icons.event_note),
            label: 'Reserve',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'More',
          ),
        ],
      ),
    );
  }
}

/// Small helper so screens can refresh the whole shell after a write.
void refreshShell(BuildContext context) {
  final db = Db.i;
  // Reading the pending count here is a cheap way to make sure the DB is warm
  // for the dashboard's first build after returning from a form.
  db.pendingCount();
}
