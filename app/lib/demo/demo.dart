import '../api/api.dart';
import '../auth/auth.dart';

/// The demo: an invented patient against a stand-in API, for looking at
/// screens without anyone signing in with a real password. Built only with
/// `--dart-define=ATRIA_DEMO=true`; the names and numbers are fictional.
class DemoAuth implements Auth {
  bool _in = false;
  Audience? _audience;

  @override
  Audience? get audience => _audience;

  @override
  Future<SignInStep> signIn(Audience audience, String email, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (password == 'wrong') throw AuthFailure('That email and password do not match.');
    _audience = audience;
    if (email.startsWith('totp')) return SignInStep.authenticatorCode;
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<SignInStep> confirmAuthenticatorCode(String code) async {
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<SignInStep> setNewPassword(String password) async {
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<String?> accessToken() async => _in ? 'demo-token' : null;

  @override
  Future<void> signOut({bool everywhere = false}) async {
    _in = false;
    _audience = null;
  }
}

class DemoApi implements Api {
  DemoApi(this._auth);
  final DemoAuth _auth;

  @override
  Future<Map<String, dynamic>> get(String path) => send('GET', path);

  @override
  Future<Map<String, dynamic>> send(String method, String path, [Object? body]) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (path == '/me') {
      final staff = _auth.audience == Audience.staff;
      return {
        'personId': staff ? 'p-desk' : 'p-preview',
        'givenName': staff ? 'Nadine' : 'Amina',
        'familyName': staff ? 'Fotso' : 'Ngo',
        'email': staff ? 'n.fotso@example.com' : 'amina.ngo@example.com',
        'tenantId': 't-rhb',
        'roles': [staff ? 'RECEPTIONIST' : 'PATIENT'],
        'patientProfileId': staff ? null : 'pp-preview',
        'staffId': staff ? 's-desk' : null,
        'clinicId': staff ? 'u-med' : null,
        'phoneVerified': true,
        'languages': ['en'],
        'permissions': <String, String>{},
        'landing': <String>[],
      };
    }
    throw ApiError(404, 'The demo has nothing at $path yet.');
  }
}
