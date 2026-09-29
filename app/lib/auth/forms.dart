/// The rules the sign-up and account forms check before anything is sent,
/// the same as the web client's (web/src/auth/passwordRules.ts, phone.ts and
/// pages/CompleteProfile.tsx), so a patient meets one set of rules wherever
/// they sign up.
library;

/// The region pack's home country (spec/atria_spec/region_packs.py, CM).
const homeDialCode = '+237';
final _homeMobile = RegExp(r'^\+2376\d{8}$');
final _e164 = RegExp(r'^\+[1-9]\d{7,14}$');

const minPasswordLength = 12;

class PasswordRule {
  const PasswordRule(this.label, this.met);
  final String label;
  final bool met;
}

List<PasswordRule> passwordRules(String password) => [
  PasswordRule('At least $minPasswordLength characters', password.length >= minPasswordLength),
  PasswordRule(
    'Upper and lower case letters',
    RegExp(r'\p{Lu}', unicode: true).hasMatch(password) && RegExp(r'\p{Ll}', unicode: true).hasMatch(password),
  ),
  PasswordRule('A number', RegExp(r'\d').hasMatch(password)),
];

/// "6 70 00 00 00" as +237670000000; a number typed with its own country
/// code is kept as it is.
String normalisePhone(String raw) {
  final compact = raw.replaceAll(RegExp(r'[\s().-]'), '').replaceFirst(RegExp(r'^00'), '+');
  if (compact.isEmpty) return '';
  return compact.startsWith('+') ? compact : '$homeDialCode$compact';
}

/// Whether a number can be a mobile: the home pattern at home, E.164 elsewhere.
bool isMobile(String e164) {
  if (!_e164.hasMatch(e164)) return false;
  return e164.startsWith(homeDialCode) ? _homeMobile.hasMatch(e164) : true;
}

/// "02/04/1990" or "2.4.1990" as 1990-04-02; null when it is not a real past date.
String? birthDate(String text, {DateTime? today}) {
  final found = RegExp(r'^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})\s*$').firstMatch(text);
  if (found == null) return null;
  final day = int.parse(found[1]!);
  final month = int.parse(found[2]!);
  final year = int.parse(found[3]!);
  final date = DateTime.utc(year, month, day);
  if (date.year != year || date.month != month || date.day != day) return null;
  if (year < 1900 || date.isAfter(today ?? DateTime.now().toUtc())) return null;
  return '${date.year.toString().padLeft(4, '0')}-${month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';
}

/// "Amina Ngo Mbe" as given "Amina", family "Ngo Mbe": the first word is the
/// given name, as the front desk writes it. Null when there is only one word.
(String, String)? splitName(String full) {
  final words = full.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.length < 2) return null;
  return (words.first, words.skip(1).join(' '));
}

bool isEmail(String text) => RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(text.trim());
