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
    final currentCode =
        int.tryParse(info.version.replaceAll(RegExp(r'\D'), '')) ?? 0;
    final outdated = release.versionCode > currentCode;
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
  Future<File> download(
    AppRelease release, {
    void Function(double)? onProgress,
  }) async {
    final dir = await getTemporaryDirectory();
    final target = File('${dir.path}/lubric-field-${release.versionName}.apk');

    await _dio.download(
      release.apkUrl,
      target.path,
      onReceiveProgress: (received, total) {
        if (total > 0) onProgress?.call(received / total);
      },
    );

    if (release.sha256.isNotEmpty) {
      final digest = await sha256.bind(target.openRead()).first;
      if (digest.toString() != release.sha256) {
        await target.delete().catchError((_) => target);
        throw StateError(
          'The downloaded file did not match the published checksum. '
          'Nothing was installed - please try again.',
        );
      }
    }
    return target;
  }

  /// Open the system installer for a downloaded APK. Android will show its
  /// normal "install this app?" prompt, including the one-time permission for
  /// this app to install packages.
  Future<void> install(File apk) async {
    final result = await OpenFilex.open(apk.path);
    if (result.type != ResultType.done) {
      throw StateError(
        'Could not open the installer (${result.type}). '
        'You can install it manually from your Downloads folder.',
      );
    }
  }
}
