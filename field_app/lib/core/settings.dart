import 'package:shared_preferences/shared_preferences.dart';

/// Persisted app settings: which server we talk to, our device token, and a
/// human label for this device (shown in the shop's device list).
///
/// A single global instance is created in `main()` and initialised before the
/// first frame, so every other part of the app can read it synchronously.
class Settings {
  static const _kServer = 'lf_server';
  static const _kToken = 'lf_token';
  static const _kDeviceName = 'lf_device_name';
  static const _kLastSync = 'lf_last_sync';

  SharedPreferences? _prefs;

  Future<void> load() async {
    _prefs = await SharedPreferences.getInstance();
  }

  SharedPreferences get _p =>
      _prefs ?? (throw StateError('Settings.load() must run before use'));

  /// Trailing slashes are stripped so callers can safely do `'${settings.server}/api/...'`.
  String get server =>
      (_p.getString(_kServer) ?? '').trim().replaceAll(RegExp(r'/+$'), '');

  String get token => _p.getString(_kToken) ?? '';

  String get deviceName => _p.getString(_kDeviceName) ?? 'Field phone';

  DateTime? get lastSync {
    final raw = _p.getString(_kLastSync);
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }

  /// A device is "paired" once it knows both the server and a device token.
  bool get isPaired => server.isNotEmpty && token.isNotEmpty;

  Future<void> setServer(String url) =>
      _p.setString(_kServer, url.trim().replaceAll(RegExp(r'/+$'), ''));

  Future<void> setToken(String value) => _p.setString(_kToken, value);

  Future<void> setDeviceName(String value) => _p.setString(_kDeviceName, value);

  Future<void> setLastSync(DateTime when) =>
      _p.setString(_kLastSync, when.toIso8601String());

  /// Un-pair this device: the server keeps the row (so the shop can see the
  /// device in its list and revoke it), we just forget the token locally.
  Future<void> unpair() async {
    await _p.remove(_kToken);
  }
}

final settings = Settings();
