import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/auth.dart';
import '../config.dart';

/// A refusal from the API, with the sentence it gave.
class ApiError implements Exception {
  ApiError(this.status, this.message, [this.code]);
  final int status;
  final String message;
  final String? code;
  @override
  String toString() => message;
}

/// Calls to the Atria API, with the signed-in person's access token.
abstract class Api {
  Future<Map<String, dynamic>> get(String path);
  Future<Map<String, dynamic>> send(String method, String path, [Object? body]);
}

class HttpApi implements Api {
  HttpApi(this._auth, {http.Client? client}) : _client = client ?? http.Client();
  final Auth _auth;
  final http.Client _client;

  @override
  Future<Map<String, dynamic>> get(String path) => send('GET', path);

  @override
  Future<Map<String, dynamic>> send(String method, String path, [Object? body]) async {
    final token = await _auth.accessToken();
    final request = http.Request(method, Uri.parse('${AtriaConfig.apiBase}$path'));
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final http.Response response;
    try {
      response = await http.Response.fromStream(await _client.send(request));
    } on Exception {
      throw ApiError(0, 'No connection. Check your network and try again.');
    }
    final text = response.body;
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    if (response.statusCode >= 400) {
      final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
      throw ApiError(
        response.statusCode,
        sentence(map['message'] as String? ?? 'Something went wrong.'),
        map['code'] as String?,
      );
    }
    return decoded is Map<String, dynamic> ? decoded : {'items': decoded};
  }
}

/// The API speaks in lower case clauses; a screen shows a sentence.
String sentence(String text) {
  final t = text.trim();
  if (t.isEmpty) return t;
  final first = t[0].toUpperCase() + t.substring(1);
  return first.endsWith('.') ? first : '$first.';
}

/// Who is signed in, as GET /me answers.
class Me {
  Me(this.raw);
  final Map<String, dynamic> raw;

  String get personId => raw['personId'] as String;
  String? get givenName => raw['givenName'] as String?;
  String? get familyName => raw['familyName'] as String?;
  String? get email => raw['email'] as String?;
  List<String> get roles => (raw['roles'] as List? ?? const []).cast<String>();
  String? get patientProfileId => raw['patientProfileId'] as String?;
  String? get staffId => raw['staffId'] as String?;
  String? get clinicId => raw['clinicId'] as String?;
  bool get phoneVerified => raw['phoneVerified'] == true;
  bool get secondFactorRequired => raw['secondFactorRequired'] == true;

  bool get isStaff => staffId != null;
  bool get isAdmin => roles.contains('TENANT_ADMIN');
  String get name => [givenName, familyName].whereType<String>().join(' ');
}
