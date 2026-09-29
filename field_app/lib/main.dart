import 'package:flutter/material.dart';

import 'app.dart';
import 'core/db.dart';
import 'core/settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Settings and the offline database must be ready before the first frame:
  // the shell decides between the pairing screen and the dashboard based on
  // them, and every screen reads from the database.
  await settings.load();
  await Db.init();

  runApp(const LubricFieldApp());
}
