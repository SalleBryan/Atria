import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// What the app remembers about this device apart from tokens: whether the
/// onboarding (Figma 31:2) has been seen, so it shows on first launch only.
class AppPrefs {
  AppPrefs({this.onboarded = false, FlutterSecureStorage? store})
    : _store = store; // ignore: prefer_initializing_formals
  final FlutterSecureStorage? _store;
  bool onboarded;

  static const _key = 'atria.onboarded';

  static Future<AppPrefs> load() async {
    const store = FlutterSecureStorage();
    var seen = false;
    try {
      seen = await store.read(key: _key) == 'yes';
    } catch (_) {
      // A store that cannot be read shows the onboarding again; nothing worse.
    }
    return AppPrefs(onboarded: seen, store: store);
  }

  Future<void> markOnboarded() async {
    onboarded = true;
    try {
      await _store?.write(key: _key, value: 'yes');
    } catch (_) {}
  }
}
