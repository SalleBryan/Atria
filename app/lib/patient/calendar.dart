import 'package:add_2_calendar/add_2_calendar.dart' as device;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/tokens.dart';
import '../ui/sheets.dart';
import 'data.dart';

/// "Add to calendar" (web/src/patient/AddToCalendar.tsx): a choice of the
/// calendars people use most, each with its own logo. Google Calendar and
/// Outlook open their own new-event page, filled in, for the person to save to
/// their account. Where the web hands Apple Calendar and other apps an .ics
/// file, the app opens the phone's own calendar with the event filled in.
/// Nothing leaves Atria until the person picks one, and then only what the
/// event needs: what, with whom, where, when and the reference.
({String title, String where, String details}) _event(Appointment a, PatientData data) {
  final who = clinicianName(data.clinicianOf(a));
  final clinic = data.clinicOf(a);
  return (
    title: '${data.typeOf(a)?.name ?? 'Visit'} with $who',
    where: [clinic?.name, clinic?.address].whereType<String>().join(', '),
    details: 'Atria reference ${a.reference}. Arrive a few minutes early.',
  );
}

String _stamp(DateTime instant) =>
    instant.toUtc().toIso8601String().replaceAll(RegExp('[-:]'), '').replaceFirst(RegExp(r'\.\d+'), '');

/// Google Calendar's page for a new event, filled in; times in UTC so it lands
/// at the clinic's time whatever zone the calendar is set to.
Uri googleCalendarLink(Appointment a, PatientData data) {
  final e = _event(a, data);
  return Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': e.title,
    'dates': '${_stamp(a.startAt)}/${_stamp(a.endAt)}',
    'details': e.details,
    'location': e.where,
  });
}

/// Outlook's page for a new event, filled in; it reads ISO times with their offset.
Uri outlookCalendarLink(Appointment a, PatientData data) {
  final e = _event(a, data);
  return Uri.https('outlook.live.com', '/calendar/0/action/compose', {
    'path': '/calendar/action/compose',
    'rru': 'addevent',
    'subject': e.title,
    'startdt': a.startAt.toUtc().toIso8601String(),
    'enddt': a.endAt.toUtc().toIso8601String(),
    'body': e.details,
    'location': e.where,
  });
}

Widget _logo(String file) => Container(
  width: 38,
  height: 38,
  padding: const EdgeInsets.all(8),
  decoration: BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: AtriaColors.lineHairline),
  ),
  child: SvgPicture.asset('assets/calendar/$file'),
);

Future<void> addToCalendar(BuildContext context, Appointment a, PatientData data) => showGlassSheet(
  context,
  title: 'Add to calendar',
  children: [
    for (final (i, choice) in [
      (
        'google-calendar.svg',
        'Google Calendar',
        'Opens in your browser, filled in',
        () => launchUrl(googleCalendarLink(a, data), mode: LaunchMode.externalApplication),
      ),
      (
        'outlook.svg',
        'Outlook',
        'Opens in your browser, filled in',
        () => launchUrl(outlookCalendarLink(a, data), mode: LaunchMode.externalApplication),
      ),
      (
        'apple.svg',
        'This phone\'s calendar',
        'Apple Calendar, or whichever calendar app you use',
        () {
          final e = _event(a, data);
          return device.Add2Calendar.addEvent2Cal(
            device.Event(
              title: e.title,
              description: e.details,
              location: e.where,
              startDate: a.startAt.toLocal(),
              endDate: a.endAt.toLocal(),
              iosParams: const device.IOSParams(reminder: Duration(hours: 2)),
            ),
          );
        },
      ),
    ].indexed) ...[
      if (i > 0) const SizedBox(height: 10),
      Builder(
        builder: (sheet) => SheetChoice(
          leading: _logo(choice.$1),
          title: choice.$2,
          sub: choice.$3,
          onTap: () {
            Navigator.of(sheet).pop();
            choice.$4();
          },
        ),
      ),
    ],
  ],
);
