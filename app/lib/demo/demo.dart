import '../api/api.dart';
import '../auth/auth.dart';
import 'mock_api.dart';

/// The people the demo signs in as, the web preview's personas
/// (web/src/dev/Preview.tsx). The email picks who; any password but "wrong"
/// works. Every name and number is invented.
///
///     amina@example.com         patient (and any other patient email)
///     n.fotso@example.com       front desk, Medical Unit
///     j.nkoulou@example.com     clinician, Medical Unit
///     r.owona@example.com       unit manager, Medical Unit
///     k.ngassa@example.com      front desk, outpatient department (runs the queue)
///     w.mbua@example.com        outpatient doctor (calls the queue)
///     e.ekane@example.com       surgeon (places procedure requests)
///     s.eyenga@example.com      administrator (sent to the web console)
///     new.*@example.com         staff first sign-in (sets a password)
///     totp.*@example.com        staff with an authenticator code
const staffPeople = <String, Map<String, dynamic>>{
  'n.fotso@example.com': {
    'personId': 'p-desk',
    'givenName': 'Nadine',
    'familyName': 'Fotso',
    'email': 'n.fotso@example.com',
    'roles': ['RECEPTIONIST'],
    'staffId': 's-desk',
    'clinicId': 'u-rhb-medicine',
    'languages': ['fr', 'en'],
  },
  'j.nkoulou@example.com': {
    'personId': 'p-nkoulou',
    'givenName': 'Jean-Paul',
    'familyName': 'Nkoulou',
    'email': 'j.nkoulou@example.com',
    'roles': ['CLINICIAN'],
    'staffId': 's-nkoulou',
    'clinicId': 'u-rhb-medicine',
    'languages': ['fr', 'en'],
  },
  'r.owona@example.com': {
    'personId': 'p-manager',
    'givenName': 'Rodrigue',
    'familyName': 'Owona',
    'email': 'r.owona@example.com',
    'roles': ['CLINIC_MANAGER'],
    'staffId': 's-manager',
    'clinicId': 'u-rhb-medicine',
    'languages': ['fr'],
  },
  'k.ngassa@example.com': {
    'personId': 'p-ngassa',
    'givenName': 'Kofi',
    'familyName': 'Ngassa',
    'email': null,
    'roles': ['RECEPTIONIST'],
    'staffId': 's-ngassa',
    'clinicId': 'u-rhb-opd',
    'languages': ['en'],
  },
  'w.mbua@example.com': {
    'personId': 'p-mbua',
    'givenName': 'Walters',
    'familyName': 'Mbua',
    'email': null,
    'roles': ['CLINICIAN'],
    'staffId': 's-mbua',
    'clinicId': 'u-rhb-opd',
    'languages': ['en'],
  },
  'e.ekane@example.com': {
    'personId': 'p-ekane',
    'givenName': 'Emmanuel',
    'familyName': 'Ekane',
    'email': null,
    'roles': ['CLINICIAN'],
    'staffId': 's-ekane',
    'clinicId': 'u-rhb-surgery',
    'languages': ['en'],
  },
  's.eyenga@example.com': {
    'personId': 'p-admin',
    'givenName': 'Sandrine',
    'familyName': 'Eyenga',
    'email': 's.eyenga@example.com',
    'roles': ['TENANT_ADMIN'],
    'staffId': 's-admin',
    'clinicId': null,
    'languages': ['fr', 'en'],
  },
};

/// The demo: invented people against a stand-in API, for looking at screens
/// and running workflows without anyone signing in with a real password.
/// Built only with `--dart-define=ATRIA_DEMO=true`.
class DemoAuth implements Auth {
  bool _in = false;
  Audience? _audience;
  String? _pendingStaff;

  /// Which staff persona is signed in, when staff are.
  Map<String, dynamic>? staff;

  /// The demo patient's record as GET /me tells it; Google and a new
  /// sign-up start without a mobile or a date of birth, as the real ones do.
  final profile = DemoProfile();
  final Map<String, NewAccount> _pendingSignUps = {};

  @override
  Audience? get audience => _audience;

  Map<String, dynamic> _staffFor(String email) {
    final known = staffPeople[email];
    if (known != null) return known;
    // new.* and totp.* sign in as the front desk once past their step.
    return staffPeople['n.fotso@example.com']!;
  }

  @override
  Future<SignInStep> signIn(Audience audience, String email, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (password == 'wrong') throw AuthFailure('That email and password do not match.');
    final address = email.trim().toLowerCase();
    _audience = audience;
    if (audience == Audience.staff) {
      if (address.startsWith('new.') || address.startsWith('totp.')) {
        _pendingStaff = address;
        return address.startsWith('new.') ? SignInStep.newPassword : SignInStep.authenticatorCode;
      }
      staff = _staffFor(address);
    } else {
      staff = null;
    }
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<SignInStep> confirmAuthenticatorCode(String code) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (code.trim() != demoCode) throw AuthFailure('That code is not right. Check your authenticator and try again.');
    staff = _staffFor(_pendingStaff ?? '');
    _in = true;
    return SignInStep.done;
  }

  // The demo's code is always 123456; anything else is refused.
  static const demoCode = '123456';

  @override
  Future<void> signUp(NewAccount account) async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (account.email.startsWith('taken')) {
      throw AuthFailure('An account already uses that email. Sign in instead, or reset the password.');
    }
    _pendingSignUps[account.email.trim()] = account;
  }

  @override
  Future<void> confirmSignUp(String email, String code) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (code.trim() != demoCode) throw AuthFailure('That code is not right. Check the latest email and try again.');
    final account = _pendingSignUps.remove(email.trim());
    if (account != null) profile.fromSignUp(account);
  }

  @override
  Future<void> resendSignUpCode(String email) async => Future<void>.delayed(const Duration(milliseconds: 300));

  @override
  Future<void> forgotPassword(Audience audience, String email) async =>
      Future<void>.delayed(const Duration(milliseconds: 400));

  @override
  Future<void> confirmNewPassword(Audience audience, String email, String code, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (code.trim() != demoCode) throw AuthFailure('That code is not right. Check the latest email and try again.');
  }

  String? _newEmail;

  @override
  Future<void> changeEmail(String email) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    _newEmail = email.trim();
  }

  @override
  Future<void> confirmEmailChange(String code) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (code.trim() != demoCode) throw AuthFailure('That code is not right. Check the latest email and try again.');
    if (_newEmail != null) profile.email = _newEmail!;
  }

  @override
  Future<SignInStep> signInWithGoogle() async {
    await Future<void>.delayed(const Duration(milliseconds: 700));
    profile.fromGoogle();
    _audience = Audience.patient;
    staff = null;
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<SignInStep> setNewPassword(String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    staff = _staffFor(_pendingStaff ?? '');
    _in = true;
    return SignInStep.done;
  }

  @override
  Future<String?> accessToken() async => _in ? 'demo-token' : null;

  @override
  Future<void> signOut({bool everywhere = false}) async {
    _in = false;
    _audience = null;
    staff = null;
  }
}

class DemoApi implements Api {
  DemoApi(this._auth);
  final DemoAuth _auth;
  final hospital = MockHospital();

  @override
  Future<Map<String, dynamic>> get(String path) => send('GET', path);

  @override
  Future<String> text(String path) async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    return hospital.auditCsv(path);
  }

  @override
  Future<Map<String, dynamic>> send(String method, String path, [Object? body, Map<String, String>? headers]) async {
    await Future<void>.delayed(Duration(milliseconds: method == 'GET' ? 300 : 500));
    final me = _auth.profile;
    final staff = _auth.staff;
    if (path == '/me' && method == 'PATCH') {
      me.patch(body as Map);
    } else if (path == '/me' && method == 'DELETE') {
      return me.delete(hospital);
    } else if (path == '/me/restore') {
      me.deletion = null;
    } else if (path == '/me/email') {
      return {};
    }
    if (path == '/me' || path.startsWith('/me/')) {
      if (staff != null) {
        return {
          ...staff,
          'tenantId': 't-cm-001',
          'phoneE164': '+12025550142',
          'phoneVerified': true,
          'patientProfileId': null,
          'missing': <String>[],
          'deletion': null,
          'permissions': <String, String>{},
          'landing': <String>[],
        };
      }
      return {
        'personId': 'p-preview',
        'givenName': me.givenName,
        'familyName': me.familyName,
        'email': me.email,
        'phoneE164': me.phone,
        'dateOfBirth': me.dateOfBirth,
        'preferredLanguage': me.language,
        'missing': me.missing,
        'deletion': me.deletion,
        'tenantId': 't-cm-001',
        'roles': ['PATIENT'],
        'patientProfileId': 'pp-preview',
        'staffId': null,
        'clinicId': null,
        'phoneVerified': me.phone != null,
        'languages': [me.language],
        'permissions': <String, String>{},
        'landing': ['Upcoming visits'],
      };
    }
    return hospital.answer(method, path, body, patientSide: staff == null);
  }
}

/// The demo patient's own record, which the account screens change.
class DemoProfile {
  String givenName = 'Amina';
  String familyName = 'Ngo';
  String email = 'amina.ngo@example.com';
  String? phone = '+237670000142';
  String? dateOfBirth = '1994-03-14';
  bool termsAccepted = true;
  String language = 'en';
  Map<String, dynamic>? deletion;

  List<String> get missing => [
    if (phone == null) 'phone',
    if (dateOfBirth == null) 'dateOfBirth',
    if (!termsAccepted) 'terms',
  ];

  void fromGoogle() {
    phone = null;
    dateOfBirth = null;
    termsAccepted = false;
  }

  void fromSignUp(NewAccount account) {
    givenName = account.givenName;
    familyName = account.familyName;
    email = account.email.trim();
    phone = account.phone;
    dateOfBirth = account.birthdate;
    termsAccepted = true;
  }

  void patch(Map body) {
    givenName = body['givenName'] as String? ?? givenName;
    familyName = body['familyName'] as String? ?? familyName;
    phone = body['phoneE164'] as String? ?? phone;
    dateOfBirth = body['dateOfBirth'] as String? ?? dateOfBirth;
    language = body['preferredLanguage'] as String? ?? language;
    if (body['acceptTerms'] == true) termsAccepted = true;
  }

  Map<String, dynamic> delete(MockHospital hospital) {
    final now = DateTime.now().toUtc();
    deletion = {
      'requestedAt': iso(now),
      'purgeAt': iso(now.add(const Duration(days: 30))),
      'by': 'SELF',
      'graceDays': 30,
    };
    return {...deletion!, 'cancelledVisits': hospital.cancelAhead('pp-preview')};
  }
}
