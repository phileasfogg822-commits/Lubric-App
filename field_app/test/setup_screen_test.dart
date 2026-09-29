// Regression test for the bug where the "Pair this device" button stayed
// permanently greyed out: `canSubmit` used to be computed inside `build()`,
// and a TextEditingController does not rebuild the widget that reads it.
//
// If this test ever fails again, the button is disabled no matter what the
// user types - exactly the symptom reported from the field.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:lubric_field/screens/setup_screen.dart';

void main() {
  testWidgets('Pair button enables once a URL and a code are typed',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SetupScreen()));

    FilledButton button() => tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Pair this device'),
        );

    // Starts disabled.
    expect(button().onPressed, isNull);

    // A URL alone is not enough - we still need a pairing code.
    await tester.enterText(find.byType(TextField).at(0), 'http://72.61.115.120:9000');
    await tester.pump();
    expect(button().onPressed, isNull,
        reason: 'URL alone must not enable the button');

    // Whitespace must not count as a value either.
    await tester.enterText(find.byType(TextField).at(1), '   ');
    await tester.pump();
    expect(button().onPressed, isNull,
        reason: 'a code of only spaces must not enable the button');

    // Typing the real code must enable it - this is the actual regression.
    await tester.enterText(find.byType(TextField).at(1), '90108629');
    await tester.pump();
    expect(button().onPressed, isNotNull,
        reason: 'button must enable once both fields have real values');

    // And it must disable again if the user clears a field.
    await tester.enterText(find.byType(TextField).at(1), '');
    await tester.pump();
    expect(button().onPressed, isNull,
        reason: 'clearing the code must disable the button again');
  });

  testWidgets('Screen offers all three fields a field user needs', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SetupScreen()));
    expect(find.text('Server URL'), findsOneWidget);
    expect(find.text('Pairing code'), findsOneWidget);
    expect(find.text('This device is called'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(3));
  });
}
