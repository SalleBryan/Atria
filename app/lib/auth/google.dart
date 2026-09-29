import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

/// Google for patients (FR-ACC-02), through Cognito's hosted sign-in.
///
/// The app opens `/oauth2/authorize` with `identity_provider=Google` in the
/// system browser (a Custom Tab on Android), Google and Cognito do their part,
/// and Cognito sends the browser back to `atria://auth/callback` with a code.
/// The code is traded at `/oauth2/token` for the patient client's tokens,
/// with PKCE so an app that cannot keep a secret still proves the code is its
/// own. The patient client lists the callback (infra config, oauth_callback_urls).
class GoogleTokens {
  const GoogleTokens({required this.idToken, required this.accessToken, required this.refreshToken});
  final String idToken;
  final String accessToken;
  final String refreshToken;
}

class GoogleSignInCancelled implements Exception {}

const callbackScheme = 'atria';
const callbackUri = 'atria://auth/callback';

String _verifier() {
  final random = Random.secure();
  final bytes = List<int>.generate(48, (_) => random.nextInt(256));
  return base64Url.encode(bytes).replaceAll('=', '');
}

String _challenge(String verifier) =>
    base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');

Future<GoogleTokens> signInWithGoogle({http.Client? client}) async {
  if (AtriaConfig.authDomain.isEmpty) {
    throw StateError('ATRIA_AUTH_DOMAIN is not set; run python tools/app_env.py');
  }
  final verifier = _verifier();
  final state = _verifier();
  final authorize = Uri.https(AtriaConfig.authDomain, '/oauth2/authorize', {
    'identity_provider': 'Google',
    'response_type': 'code',
    'client_id': AtriaConfig.patientClientId,
    'redirect_uri': callbackUri,
    'scope': 'openid email profile',
    'state': state,
    'code_challenge': _challenge(verifier),
    'code_challenge_method': 'S256',
  });

  final String result;
  try {
    result = await FlutterWebAuth2.authenticate(url: authorize.toString(), callbackUrlScheme: callbackScheme);
  } on PlatformException catch (e) {
    if (e.code == 'CANCELED') throw GoogleSignInCancelled();
    rethrow;
  }
  final back = Uri.parse(result);
  final error = back.queryParameters['error_description'] ?? back.queryParameters['error'];
  if (error != null) throw StateError(error);
  if (back.queryParameters['state'] != state) throw StateError('Google sign-in came back for another request.');
  final code = back.queryParameters['code'];
  if (code == null) throw StateError('Google sign-in did not complete.');

  final response = await (client ?? http.Client()).post(
    Uri.https(AtriaConfig.authDomain, '/oauth2/token'),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: {
      'grant_type': 'authorization_code',
      'client_id': AtriaConfig.patientClientId,
      'code': code,
      'redirect_uri': callbackUri,
      'code_verifier': verifier,
    },
  );
  if (response.statusCode != 200) throw StateError('Google sign-in could not be finished. Try again.');
  final tokens = jsonDecode(response.body) as Map<String, dynamic>;
  return GoogleTokens(
    idToken: tokens['id_token'] as String,
    accessToken: tokens['access_token'] as String,
    refreshToken: tokens['refresh_token'] as String,
  );
}
