import '../api/api.dart';
import '../auth/auth.dart';
import 'fixtures.dart' as fixtures;

/// The demo: an invented patient against a stand-in API, for looking at
/// screens without anyone signing in with a real password. Built only with
/// `--dart-define=ATRIA_DEMO=true`; the names and numbers are fictional.
class DemoAuth implements Auth {
  bool _in = false;
  Audience? _audience;

  /// The demo patient's record as GET /me tells it; Google and a new
  /// sign-up start without a mobile or a date of birth, as the real ones do.
  final profile = DemoProfile();
  final Map<String, NewAccount> _pendingSignUps = {};

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
  Future<Map<String, dynamic>> send(String method, String path, [Object? body, Map<String, String>? headers]) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    final me = _auth.profile;
    if (path == '/me' && method == 'PATCH') {
      me.patch(body as Map);
    } else if (path == '/me' && method == 'DELETE') {
      return me.delete();
    } else if (path == '/me/restore') {
      me.deletion = null;
    } else if (path == '/me/email') {
      return {};
    }
    if (path.startsWith('/me')) {
      final staff = _auth.audience == Audience.staff;
      return {
        'personId': staff ? 'p-desk' : 'p-preview',
        'givenName': staff ? 'Nadine' : me.givenName,
        'familyName': staff ? 'Fotso' : me.familyName,
        'email': staff ? 'n.fotso@example.com' : me.email,
        'phoneE164': staff ? '+12025550161' : me.phone,
        'dateOfBirth': staff ? null : me.dateOfBirth,
        'preferredLanguage': me.language,
        'missing': staff ? <String>[] : me.missing,
        'deletion': staff ? null : me.deletion,
        'tenantId': 't-rhb',
        'roles': [staff ? 'RECEPTIONIST' : 'PATIENT'],
        'patientProfileId': staff ? null : 'pp-preview',
        'staffId': staff ? 's-desk' : null,
        'clinicId': staff ? 'u-med' : null,
        'phoneVerified': true,
        'languages': [me.language],
        'permissions': <String, String>{},
        'landing': <String>[],
      };
    }
    final uri = Uri.parse(path);
    switch (uri.path) {
      case '/patients/me/appointments':
        return {'appointments': fixtures.appointments(), 'nextCursor': null};
      case '/clinicians':
        return {'clinicians': fixtures.clinicians, 'nextCursor': null};
      case '/clinics':
        return {'clinics': fixtures.clinics, 'nextCursor': null};
      case '/appointment-types':
        return {'appointmentTypes': fixtures.types, 'gridUnitMinutes': 10, 'nextCursor': null};
    }
    if (RegExp(r'^/clinics/[^/]+/sessions$').hasMatch(uri.path)) {
      return {'sessions': fixtures.sessions()};
    }
    final ticket = RegExp(r'^/sessions/([^/]+)/tickets$').firstMatch(uri.path);
    if (ticket != null && method == 'POST') return fixtures.takePlace(ticket.group(1)!);
    final oneSession = RegExp(r'^/sessions/([^/]+)$').firstMatch(uri.path);
    if (oneSession != null) {
      fixtures.sessions();
      return fixtures.sessionById(oneSession.group(1)!);
    }
    final slots = RegExp(r'^/clinicians/([^/]+)/slots$').firstMatch(uri.path);
    if (slots != null) {
      return uri.queryParameters.containsKey('from')
          ? {'days': fixtures.weekFor(slots.group(1)!)}
          : {'slots': fixtures.slotsFor(slots.group(1)!)};
    }
    if (method == 'POST' && uri.path == '/appointments') {
      final b = body as Map;
      final start = DateTime.parse(b['startAt'] as String);
      final made = {
        'appointmentId': 'a-${fixtures.appointments().length + 1}',
        'reference': 'APT-${6000 + fixtures.appointments().length}',
        'clinicId': fixtures.clinicians.firstWhere(
          (c) => c['clinicianProfileId'] == b['clinicianProfileId'],
        )['clinicId'],
        'patientProfileId': 'pp-preview',
        'appointmentTypeId': b['appointmentTypeId'],
        'clinicianProfileId': b['clinicianProfileId'],
        'startAt': b['startAt'],
        'endAt': start.add(const Duration(minutes: 30)).toIso8601String().replaceFirst('.000', ''),
        'state': 'BOOKED',
        'channel': 'ONLINE',
        'createdAt': DateTime.now().toUtc().toIso8601String(),
        'version': 1,
      };
      fixtures.appointments().add(made);
      return made;
    }
    final one = RegExp(r'^/appointments/([^/]+)(/(confirm|reschedule))?$').firstMatch(uri.path);
    if (one != null) {
      final visit = fixtures.appointments().firstWhere((a) => a['appointmentId'] == one.group(1));
      final action = one.group(3);
      if (method == 'DELETE') {
        visit['state'] = 'PATIENT_CANCELLED';
        return {...visit, 'outcome': 'CANCELLED_IN_WINDOW'};
      }
      if (action == 'confirm') visit['state'] = 'CONFIRMED';
      if (action == 'reschedule') {
        final start = DateTime.parse((body as Map)['startAt'] as String);
        visit['startAt'] = body['startAt'];
        visit['endAt'] = start.add(const Duration(minutes: 30)).toIso8601String().replaceFirst('.000', '');
        visit['state'] = 'RESCHEDULED';
      }
      return {
        ...visit,
        'cancellationPreview': {
          'outcome': 'CANCELLED_IN_WINDOW',
          'entitlement': 'FULL',
          'amountMinor': 5000,
          'currency': 'XAF',
        },
      };
    }
    throw ApiError(404, 'The demo has nothing at $path yet.');
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

  Map<String, dynamic> delete() {
    final now = DateTime.now().toUtc();
    deletion = {
      'requestedAt': now.toIso8601String(),
      'purgeAt': now.add(const Duration(days: 30)).toIso8601String(),
      'by': 'SELF',
      'graceDays': 30,
    };
    return {...deletion!, 'cancelledVisits': fixtures.cancelAhead()};
  }
}
