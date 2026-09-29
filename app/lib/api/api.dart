import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/auth.dart';
import '../config.dart';

/// A refusal from the API, with the sentence it gave.
class ApiError implements Exception {
  ApiError(this.status, this.message, [this.code, this.detail]);
  final int status;
  final String message;
  final String? code;

  /// What the API adds to a refusal, such as the patients already on a number.
  final Map<String, dynamic>? detail;
  @override
  String toString() => message;
}

/// Calls to the Atria API, with the signed-in person's access token.
abstract class Api {
  Future<Map<String, dynamic>> get(String path);

  /// A plain text answer, such as the audit log's CSV export.
  Future<String> text(String path);
  Future<Map<String, dynamic>> send(String method, String path, [Object? body, Map<String, String>? headers]);
}

class HttpApi implements Api {
  HttpApi(this._auth, {http.Client? client}) : _client = client ?? http.Client();
  final Auth _auth;
  final http.Client _client;

  @override
  Future<Map<String, dynamic>> get(String path) => send('GET', path);

  @override
  Future<String> text(String path) async {
    final token = await _auth.accessToken();
    final http.Response response;
    try {
      response = await _client.get(
        Uri.parse('${AtriaConfig.apiBase}$path'),
        headers: {if (token != null) 'Authorization': 'Bearer $token'},
      );
    } on Exception {
      throw ApiError(0, 'No connection. Check your network and try again.');
    }
    if (response.statusCode >= 400) throw ApiError(response.statusCode, 'That could not be fetched.');
    return response.body;
  }

  @override
  Future<Map<String, dynamic>> send(String method, String path, [Object? body, Map<String, String>? headers]) async {
    final token = await _auth.accessToken();
    final request = http.Request(method, Uri.parse('${AtriaConfig.apiBase}$path'));
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (headers != null) request.headers.addAll(headers);
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
        map['detail'] as Map<String, dynamic>?,
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
  String? get phoneE164 => raw['phoneE164'] as String?;
  String? get dateOfBirth => raw['dateOfBirth'] as String?;
  String? get preferredLanguage => raw['preferredLanguage'] as String?;
  List<String> get languages => (raw['languages'] as List? ?? const []).cast<String>();

  /// What a patient's record still lacks: phone, dateOfBirth, terms (GET /me).
  List<String> get missing => (raw['missing'] as List? ?? const []).cast<String>();

  /// A deletion waiting out its 30 days: purgeAt, by (SELF or ADMIN).
  Map<String, dynamic>? get deletion => raw['deletion'] as Map<String, dynamic>?;

  bool get isStaff => staffId != null;
  bool get isAdmin => roles.contains('TENANT_ADMIN');
  String get name => [givenName, familyName].whereType<String>().join(' ');
}
