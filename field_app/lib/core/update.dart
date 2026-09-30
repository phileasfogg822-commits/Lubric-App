import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'settings.dart';

/// What the shop publishes on the server at `updates/android.json`.
///
/// This is deliberately the same shape the Mirror Twins game already uses, so
/// publishing a new build is a familiar two-step job: drop the APK into
/// `updates/android/` on the VPS and bump this file.
class AppRelease {
  const AppRelease({
    required this.versionCode,
    required this.versionName,
    required this.apkUrl,
    required this.sha256,
    required this.mandatory,
    required this.notes,
  });

  final int versionCode;
  final String versionName;
  final String apkUrl;
  final String sha256;
  final bool mandatory;
  final String notes;

  factory AppRelease.fromJson(Map<String, dynamic> j) => AppRelease(
        versionCode: (j['versionCode'] as num?)?.toInt() ?? 0,
        versionName: (j['versionName'] as String?) ?? '',
        apkUrl: (j['apk'] ?? j['url'] ?? '') as String,
        sha256: (j['sha256'] as String? ?? '').toLowerCase(),
        mandatory: j['mandatory'] == true,
        notes: (j['notes'] as String?) ?? '',
      );
}

class UpdateCheck {
  const UpdateCheck({
    required this.currentCode,
    required this.currentName,
    required this.available,
  });

  final int currentCode;
  final String currentName;

  /// Null when already up to date.
  final AppRelease? available;

  bool get isOutdated => available != null;
  bool get isMandatory => available?.mandatory ?? false;
}

/// The installed build's versionCode.
///
/// This must be `buildNumber` - the integer after the `+` in pubspec.yaml
/// (`0.4.0+4` -> 4) - and NOT the version NAME. Parsing the name looked
/// equivalent but is not: stripping the dots off "0.4.0" yields 40, so the
/// phone reported itself as build 40 and compared it against the published
/// 1, 2, 3, 4, ... Updates could therefore never be offered. The whole update
/// feature was dead from the day it shipped, which is why every new build had
/// to be downloaded and installed by hand.
int installedVersionCode(PackageInfo info) {
  return int.tryParse(info.buildNumber.trim()) ?? 0;
}

/// Is the published build newer than the one on the phone?
bool isUpdateAvailable(int installedCode, int publishedCode) {
  return publishedCode > installedCode;
}

class UpdateService {
  UpdateService._();
  static final UpdateService i = UpdateService._();

  final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 12),
    receiveTimeout: const Duration(seconds: 30),
  ));

  /// Ask the server what the newest build is. Returns null (not an error) if
  /// the server has no manifest yet - a brand new install simply has nothing
  /// to update to, and the app must keep working.
  Future<UpdateCheck?> check() async {
    final info = await PackageInfo.fromPlatform();

    Map<String, dynamic>? manifest;
    for (final path in const ['/api/v1/app/version', '/updates/android.json']) {
      try {
        final res = await _dio.get<Map<String, dynamic>>(
          '${settings.server}$path',
        );
        final data = res.data;
        if (data != null && data['versionCode'] != null) {
          manifest = data;
          break;
        }
      } on DioException {
        // Try the next location; if neither works there is nothing to update.
        continue;
      }
    }
    if (manifest == null) return null;

    final release = AppRelease.fromJson(manifest);
    final currentCode = installedVersionCode(info);
    final outdated = isUpdateAvailable(currentCode, release.versionCode);
    return UpdateCheck(
      currentCode: currentCode,
      currentName: info.version,
      available: outdated ? release : null,
    );
  }

  /// Download the APK, verify its SHA-256 against the published manifest, and
  /// hand it to Android's installer.
  ///
  /// `onProgress` receives 0.0-1.0 so the UI can show a real progress bar -
  /// a 20 MB download over a shop's 4G connection is not something to leave
  /// as an indeterminate spinner.
  ///
  /// Writes to the app's EXTERNAL files directory rather than the internal
  /// cache. The old location was invisible to the user (and purgeable by
  /// Android at any time), which is why a completed download could not be found
  /// anywhere - "it downloaded and I never knew where". `open_filex`'s
  /// FileProvider already covers this path, so the installer can still read it.
  Future<File> download(
    AppRelease release, {
    void Function(double)? onProgress,
  }) async {
    final dir = await _downloadDir();
    final target = File('${dir.path}/${release.versionName}.apk');
    final partial = File('${target.path}.part');

    // Download to .part first, so an interrupted transfer can never be mistaken
    // for a finished APK by the installer.
    if (await partial.exists()) await partial.delete();

    await _dio.download(
      release.apkUrl,
      partial.path,
      onReceiveProgress: (received, total) {
        if (total > 0) onProgress?.call(received / total);
      },
    );

    if (release.sha256.isNotEmpty) {
      final digest = await sha256.bind(partial.openRead()).first;
      if (digest.toString() != release.sha256) {
        await partial.delete().catchError((_) => partial);
        throw StateError(
          'The downloaded file did not match the published checksum. '
          'Nothing was installed - please try again.',
        );
      }
    }

    if (await target.exists()) await target.delete();
    return partial.rename(target.path);
  }

  /// Where updates are kept, preferring external storage so the file is
  /// reachable by a file manager and survives a cache clear.
  Future<Directory> _downloadDir() async {
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        final dir = Directory('${ext.path}/updates');
        if (!await dir.exists()) await dir.create(recursive: true);
        return dir;
      }
    } catch (_) {
      // Falls through to the cache on devices without external storage.
    }
    final tmp = await getTemporaryDirectory();
    final dir = Directory('${tmp.path}/updates');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Open the system installer for a downloaded APK. Android will show its
  /// normal "install this app?" prompt, including the one-time permission for
  /// this app to install packages.
  ///
  /// The error messages here are deliberately specific. This step used to fail
  /// with "it just did not install", because the manifest had no
  /// REQUEST_INSTALL_PACKAGES and Android refused the intent without saying so.
  Future<void> install(File apk) async {
    if (!await apk.exists()) {
      throw StateError(
        'The downloaded file is missing from ${apk.path}. Please download again.',
      );
    }

    final result = await OpenFilex.open(apk.path);
    if (result.type == ResultType.done) return;

    throw StateError(
      switch (result.type) {
        ResultType.permissionDenied =>
          'Android did not allow the install. Open Settings → Apps → '
              'Lubric Field → Install unknown apps, allow it, then try again.',
        ResultType.fileNotFound =>
          'The update file was not found at ${apk.path}. Please download again.',
        _ =>
          'The installer did not open (${result.type}). You can also install it '
              'by hand from: ${apk.path}',
      },
    );
  }
}
