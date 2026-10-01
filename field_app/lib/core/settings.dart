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
  static const _kLastError = 'lf_last_error';
  static const _kCollector = 'lf_collector_name';

  SharedPreferences? _p;

  Future<void> load() async {
    _p = await SharedPreferences.getInstance();
  }

  /// Safe to read before [load] has run. A not-yet-loaded store simply behaves
  /// as "nothing configured yet" rather than throwing, so widgets can be built
  /// and tested without a plugin initialised.
  String get server =>
      (_p?.getString(_kServer) ?? '').trim().replaceAll(RegExp(r'/+$'), '');

  String get token => _p?.getString(_kToken) ?? '';

  String get deviceName => _p?.getString(_kDeviceName) ?? 'Field phone';

  DateTime? get lastSync {
    final raw = _p?.getString(_kLastSync);
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }

  /// A device is "paired" once it knows both the server and a device token.
  bool get isPaired => server.isNotEmpty && token.isNotEmpty;

  Future<void> setServer(String url) async {
    await _p?.setString(_kServer, url.trim().replaceAll(RegExp(r'/+$'), ''));
  }

  Future<void> setToken(String value) async => _p?.setString(_kToken, value);

  Future<void> setDeviceName(String value) async =>
      _p?.setString(_kDeviceName, value);

  /// Who is using this phone, in their own words.
  ///
  /// The device token tells the shop which phone took a payment, not which
  /// person was holding it - and those are different questions the moment a
  /// phone is shared or swapped. Typed once here and stamped onto every record,
  /// so collections can be traced to a person rather than a handset. Optional:
  /// the shop falls back to the device name when this is blank.
  String get collectorName =>
      (_p?.getString(_kCollector) ?? '').trim();

  Future<void> setCollectorName(String value) async =>
      _p?.setString(_kCollector, value.trim());

  Future<void> setLastSync(DateTime when) async =>
      _p?.setString(_kLastSync, when.toIso8601String());

  /// The last thing that went wrong, kept across restarts.
  ///
  /// A SnackBar is gone the moment the screen closes, so a field user
  /// reporting "it does not sync" had nothing to read back. This is what the
  /// diagnostics screen shows.
  String get lastError => _p?.getString(_kLastError) ?? '';

  Future<void> setLastError(String message) async {
    if (message.isEmpty) {
      await _p?.remove(_kLastError);
    } else {
      await _p?.setString(_kLastError, message);
    }
  }

  /// Just the tail of the token, enough to tell two devices apart.
  String get tokenHint => token.isEmpty
      ? 'none'
      : '${token.substring(0, token.length > 8 ? 6 : token.length)}…'
          ' (${token.length} chars)';

  /// Un-pair this device: the server keeps the row (so the shop can see the
  /// device in its list and revoke it), we just forget the token locally.
  Future<void> unpair() async {
    await _p?.remove(_kToken);
  }
}

final settings = Settings();
