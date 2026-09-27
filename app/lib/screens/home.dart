import 'package:flutter/material.dart';

import '../api/api.dart';
import '../auth/session.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/widgets.dart';

/// "Mobile · Home": the greeting for now; the next visit, quick actions and
/// upcoming visits follow screen by screen (web/src/patient/Home.tsx).
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.session, required this.me});
  final Session session;
  final Me me;

  String get greeting {
    final hour = DateTime.now().hour;
    return hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(gradient: AtriaGradients.page),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(AtriaSpace.s5),
            children: [
              Rise(
                child: Row(
                  children: [
                    Expanded(child: Text('$greeting, ${me.givenName ?? 'there'}', style: AtriaType.display(size: 26))),
                    IconButton(
                      tooltip: 'Sign out',
                      icon: const Icon(Icons.logout, color: AtriaColors.ink700),
                      onPressed: () => session.signOut(),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Rise(
                index: 1,
                child: Text(me.isStaff ? 'Staff · ${me.roles.join(', ')}' : 'Patient', style: AtriaType.body()),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
