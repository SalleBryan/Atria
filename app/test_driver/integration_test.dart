import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// Runs on the computer while a tour runs on the phone, and saves each
/// screenshot the tour takes to `build/shots/name.png` (or `ATRIA_SHOTS`).
Future<void> main() {
  final folder = Directory(Platform.environment['ATRIA_SHOTS'] ?? 'build/shots')..createSync(recursive: true);
  return integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      File('${folder.path}/$name.png').writeAsBytesSync(bytes);
      return true;
    },
  );
}
