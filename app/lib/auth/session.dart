import 'package:flutter/foundation.dart';

import '../api/api.dart';
import 'auth.dart';

sealed class SessionState {
  const SessionState();
}

class Loading extends SessionState {
  const Loading();
}

class SignedOut extends SessionState {
  const SignedOut();
}

class SignedIn extends SessionState {
  const SignedIn(this.me, this.audience);
  final Me me;
  final Audience audience;
}

/// Valid tokens the API cannot resolve, such as a patient whose records the
/// sign-up trigger has not written yet.
class Unresolved extends SessionState {
  const Unresolved(this.message);
  final String message;
}

/// Who is signed in, as the API sees them. A Cognito session alone is not
/// enough: the session is signed in only once GET /me answers.
class Session extends ChangeNotifier {
  Session(this.auth, this.api);
  final Auth auth;
  final Api api;

  SessionState _state = const Loading();
  SessionState get state => _state;

  Future<SessionState> refresh() async {
    final token = await auth.accessToken();
    if (token == null) return _set(const SignedOut());
    try {
      final me = Me(await api.get('/me'));
      final audience = auth.audience ?? (me.isStaff ? Audience.staff : Audience.patient);
      if (audience == Audience.staff && me.isAdmin) {
        // The administration console is the web's alone (the app is for
        // patients and staff at work); an administrator signs in there.
        await auth.signOut();
        return _set(const Unresolved('Administrators use the Atria console on the web.'));
      }
      return _set(SignedIn(me, audience));
    } on ApiError catch (e) {
      return _set(Unresolved(e.message));
    }
  }

  Future<void> signOut({bool everywhere = false}) async {
    await auth.signOut(everywhere: everywhere);
    _set(const SignedOut());
  }

  SessionState _set(SessionState next) {
    _state = next;
    notifyListeners();
    return next;
  }
}
