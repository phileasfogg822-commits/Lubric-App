// Regression test for the in-app updater never offering an update.
//
// The phone's own version was derived by stripping the non-digits out of the
// version NAME: "0.4.0" became 40. Published builds are numbered 1, 2, 3, 4,
// so `published > installed` was always false and no phone was ever told about a
// new build. Every update had to be downloaded and installed by hand.
//
// If this test fails, the updater is dead again.
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'package:lubric_field/core/update.dart';

PackageInfo info(String version, String buildNumber) => PackageInfo(
      appName: 'Lubric Field',
      packageName: 'app.lubric.lubric_field',
      version: version,
      buildNumber: buildNumber,
    );

void main() {
  group('installed version code', () {
    test('is read from buildNumber, not from the version name', () {
      // The exact regression: the name reads as 40 if you strip its dots.
      expect(installedVersionCode(info('0.4.0', '4')), 4);
    });

    test('a double-digit build is not confused by a double-digit name', () {
      expect(installedVersionCode(info('0.10.0', '10')), 10);
    });

    test('a three-digit name component cannot inflate the code', () {
      expect(installedVersionCode(info('1.2.300', '12')), 12);
    });

    test('an unreadable build number falls back to 0 rather than throwing', () {
      expect(installedVersionCode(info('0.5.0', 'not-a-number')), 0);
      expect(installedVersionCode(info('0.5.0', '')), 0);
    });
  });

  group('update availability', () {
    test('a newer published build is offered', () {
      expect(isUpdateAvailable(4, 5), isTrue);
    });

    test('the same build is not offered', () {
      expect(isUpdateAvailable(4, 4), isFalse);
    });

    test('an older published build is not offered', () {
      // The server can legitimately lag behind a phone that was updated by hand.
      expect(isUpdateAvailable(5, 4), isFalse);
    });

    test('a phone on 0.1.0 build 1 is offered build 2', () {
      // The two real published builds from the field reports.
      expect(isUpdateAvailable(1, 2), isTrue);
    });
  });
}
