import 'package:amazon_cognito_identity_dart_2/cognito.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config.dart';
import 'google.dart' as google;
import 'google.dart' show GoogleTokens;

/// Patients and staff sign in through different Cognito app clients
/// (FR-ACC-03): only the patient client offers Google, and the staff client's
/// session lasts a working day. Amplify for Flutter holds one client per app,
/// so the app talks to Cognito directly and keeps one pool object per
/// audience (ADR 0021).
enum Audience { patient, staff }

/// What a sign-in attempt needs next.
enum SignInStep { done, newPassword, authenticatorCode, confirmEmail }

class AuthFailure implements Exception {
  AuthFailure(this.message);
  final String message;
  @override
  String toString() => message;
}

/// What a new patient gives the sign-up; the post confirmation trigger
/// writes the person from these attributes (FR-ACC-01).
class NewAccount {
  const NewAccount({
    required this.email,
    required this.password,
    required this.givenName,
    required this.familyName,
    required this.phone,
    required this.birthdate,
  });
  final String email;
  final String password;
  final String givenName;
  final String familyName;
  final String phone;
  final String birthdate;
}

abstract class Auth {
  Future<SignInStep> signIn(Audience audience, String email, String password);

  /// A patient's own account (FR-ACC-01): Cognito sends a code to the email.
  Future<void> signUp(NewAccount account);
  Future<void> confirmSignUp(String email, String code);
  Future<void> resendSignUpCode(String email);

  /// Forgotten password: a code to the email, then the new password with it.
  Future<void> forgotPassword(Audience audience, String email);
  Future<void> confirmNewPassword(Audience audience, String email, String code, String password);

  /// Continue with Google, patients only (auth/google.dart).
  Future<SignInStep> signInWithGoogle();
  Future<SignInStep> confirmAuthenticatorCode(String code);
  Future<SignInStep> setNewPassword(String password);

  /// The access token for the audience last signed in, refreshed when due, or null.
  Future<String?> accessToken();
  Audience? get audience;
  Future<void> signOut({bool everywhere = false});
}

/// Tokens kept in the platform's secure store: the Keychain on iOS,
/// EncryptedSharedPreferences on Android.
class SecureCognitoStorage extends CognitoStorage {
  SecureCognitoStorage(this.prefix);
  final String prefix;
  static const _store = FlutterSecureStorage();

  @override
  Future<dynamic> getItem(String key) => _store.read(key: '$prefix$key');
  @override
  Future<dynamic> setItem(String key, value) => _store.write(key: '$prefix$key', value: value?.toString());
  @override
  Future<dynamic> removeItem(String key) => _store.delete(key: '$prefix$key');
  @override
  Future<void> clear() async {
    final all = await _store.readAll();
    for (final key in all.keys.where((k) => k.startsWith(prefix))) {
      await _store.delete(key: key);
    }
  }
}

class CognitoAuth implements Auth {
  CognitoAuth({CognitoStorage Function(Audience)? storage})
    : _storage = storage ?? ((a) => SecureCognitoStorage('atria.${a.name}.'));

  final CognitoStorage Function(Audience) _storage;
  final _pools = <Audience, CognitoUserPool>{};
  CognitoUser? _pending;
  Audience? _audience;

  @override
  Audience? get audience => _audience;

  CognitoUserPool _pool(Audience a) => _pools.putIfAbsent(
    a,
    () => CognitoUserPool(
      AtriaConfig.userPoolId,
      a == Audience.patient ? AtriaConfig.patientClientId : AtriaConfig.staffClientId,
      storage: _storage(a),
    ),
  );

  @override
  Future<SignInStep> signIn(Audience audience, String email, String password) async {
    final pool = _pool(audience);
    final user = CognitoUser(email.trim(), pool, storage: pool.storage);
    _pending = user;
    _audience = audience;
    try {
      await user.authenticateUser(AuthenticationDetails(username: email.trim(), password: password));
      return SignInStep.done;
    } on CognitoUserNewPasswordRequiredException {
      return SignInStep.newPassword;
    } on CognitoUserTotpRequiredException {
      return SignInStep.authenticatorCode;
    } on CognitoUserConfirmationNecessaryException {
      return SignInStep.confirmEmail;
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<void> signUp(NewAccount account) async {
    try {
      await _pool(Audience.patient).signUp(
        account.email.trim(),
        account.password,
        userAttributes: [
          AttributeArg(name: 'email', value: account.email.trim()),
          AttributeArg(name: 'given_name', value: account.givenName),
          AttributeArg(name: 'family_name', value: account.familyName),
          AttributeArg(name: 'phone_number', value: account.phone),
          AttributeArg(name: 'birthdate', value: account.birthdate),
        ],
      );
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  CognitoUser _patient(String email) {
    final pool = _pool(Audience.patient);
    return CognitoUser(email.trim(), pool, storage: pool.storage);
  }

  @override
  Future<void> confirmSignUp(String email, String code) async {
    try {
      await _patient(email).confirmRegistration(code.trim());
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<void> resendSignUpCode(String email) async {
    try {
      await _patient(email).resendConfirmationCode();
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<void> forgotPassword(Audience audience, String email) async {
    final pool = _pool(audience);
    try {
      await CognitoUser(email.trim(), pool, storage: pool.storage).forgotPassword();
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<void> confirmNewPassword(Audience audience, String email, String code, String password) async {
    final pool = _pool(audience);
    try {
      await CognitoUser(email.trim(), pool, storage: pool.storage).confirmPassword(code.trim(), password);
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<SignInStep> signInWithGoogle() async {
    final GoogleTokens tokens;
    try {
      tokens = await google.signInWithGoogle();
    } on google.GoogleSignInCancelled {
      throw AuthFailure('Google sign-in was cancelled.');
    } on StateError catch (e) {
      throw AuthFailure(e.message);
    }
    // Kept as the patient pool keeps a password sign-in, so accessToken and
    // refresh work the same way from here on.
    final id = CognitoIdToken(tokens.idToken);
    final username = id.payload['cognito:username'] as String? ?? id.payload['sub'] as String;
    final pool = _pool(Audience.patient);
    final user = CognitoUser(
      username,
      pool,
      storage: pool.storage,
      signInUserSession: CognitoUserSession(
        id,
        CognitoAccessToken(tokens.accessToken),
        refreshToken: CognitoRefreshToken(tokens.refreshToken),
      ),
    );
    await user.cacheTokens();
    _audience = Audience.patient;
    return SignInStep.done;
  }

  @override
  Future<SignInStep> confirmAuthenticatorCode(String code) async {
    final user = _pending;
    if (user == null) throw AuthFailure('Sign in again to continue.');
    try {
      await user.sendMFACode(code, 'SOFTWARE_TOKEN_MFA');
      return SignInStep.done;
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<SignInStep> setNewPassword(String password) async {
    final user = _pending;
    if (user == null) throw AuthFailure('Sign in again to continue.');
    try {
      await user.sendNewPasswordRequiredAnswer(password);
      return SignInStep.done;
    } on CognitoClientException catch (e) {
      throw AuthFailure(messageFor(e.code, e.message));
    }
  }

  @override
  Future<String?> accessToken() async {
    for (final a in _audience == null ? Audience.values : [_audience!]) {
      final user = await _pool(a).getCurrentUser();
      if (user == null) continue;
      try {
        final session = await user.getSession();
        if (session != null && session.isValid()) {
          _audience = a;
          return session.getAccessToken().getJwtToken();
        }
      } on CognitoClientException {
        // A refresh token that has run out: signed out for this audience.
      }
    }
    return null;
  }

  @override
  Future<void> signOut({bool everywhere = false}) async {
    final a = _audience;
    if (a == null) return;
    final user = await _pool(a).getCurrentUser();
    if (user != null) {
      await user.getSession().catchError((_) => null);
      try {
        if (everywhere) {
          // FR-ACC-12: revokes every refresh token the account holds.
          await user.globalSignOut();
        } else {
          await user.signOut(revokeRefreshToken: true);
        }
      } on CognitoClientException {
        await user.signOut();
      }
    }
    _audience = null;
    _pending = null;
  }
}

/// Cognito's failures in words a person can act on, as the web client says them.
String messageFor(String? code, String? fallback) {
  switch (code) {
    case 'NotAuthorizedException':
      // An account an administrator deleted (or suspended) is disabled.
      if ((fallback ?? '').toLowerCase().contains('disabled')) {
        return 'This account has been closed by the hospital. Contact the front desk: it can be restored within 30 days of closing.';
      }
      return 'That email and password do not match.';
    case 'UserNotFoundException':
      return 'That email and password do not match.';
    case 'CodeMismatchException':
      return 'That code is not right. Check the app and try again.';
    case 'ExpiredCodeException':
      return 'That code has expired. Use the one showing now.';
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'UsernameExistsException':
      return 'An account already uses that email. Sign in instead, or reset the password.';
    case 'InvalidPasswordException':
      return 'That password does not meet the rules listed.';
    case 'UserNotConfirmedException':
      return 'Confirm your email first: use the code we sent you.';
    case 'PasswordResetRequiredException':
      return 'Your password must be reset before you can sign in.';
    case 'NetworkError':
      return 'No connection. Check your network and try again.';
    default:
      return fallback ?? 'Sign-in did not complete. Try again.';
  }
}
