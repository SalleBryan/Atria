import 'package:atria/patient/data.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a wait reads in minutes only below an hour', () {
    expect(shortWait(0), '~0m');
    expect(shortWait(59), '~59m');
    expect(shortWait(60), '~1h');
    expect(shortWait(80), '~1h 20m');
    expect(shortWait(23 * 60 + 59), '~23h 59m');
    expect(shortWait(24 * 60), '~1d');
    expect(shortWait(50 * 60), '~2d');
  });
}
