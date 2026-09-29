/// Where the app signs in and what it calls.
///
/// Passed at build time with `--dart-define-from-file=env/dev.json`, which
/// `python tools/app_env.py` writes from the deployed stacks. None of it is a
/// secret; it is read from AWS rather than committed because it changes when a
/// stack is recreated. `ATRIA_DEMO=true` runs against a stand-in API with an
/// invented person, for looking at screens without signing in.
class AtriaConfig {
  static const region = String.fromEnvironment('ATRIA_REGION', defaultValue: 'us-east-1');
  static const userPoolId = String.fromEnvironment('ATRIA_USER_POOL_ID');
  static const patientClientId = String.fromEnvironment('ATRIA_PATIENT_CLIENT_ID');
  static const staffClientId = String.fromEnvironment('ATRIA_STAFF_CLIENT_ID');

  /// Cognito's hosted sign-in, for Google (auth/google.dart), for example
  /// atria-dev-cm.auth.us-east-1.amazoncognito.com.
  static const authDomain = String.fromEnvironment('ATRIA_AUTH_DOMAIN');

  /// The API stage's base URL, for example https://abc.execute-api.us-east-1.amazonaws.com/dev.
  static const apiBase = String.fromEnvironment('ATRIA_API_BASE');

  static const demo = bool.fromEnvironment('ATRIA_DEMO');

  /// The hospital the app is for (the tenant's display name).
  static const hospital = String.fromEnvironment('ATRIA_HOSPITAL', defaultValue: 'Regional Hospital Buea');

  static bool get configured => userPoolId.isNotEmpty && patientClientId.isNotEmpty && apiBase.isNotEmpty;
}
