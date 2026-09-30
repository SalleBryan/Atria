import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/filters.dart';
import '../ui/glass.dart';
import '../ui/layout.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// Messages, reports and the audit log: what the unit sent, how its weeks
/// went, and who opened or changed what.

const kindLabel = {
  'BOOKING_CONFIRMATION': 'Booking confirmed',
  'BOOKING_CANCELLATION': 'Visit cancelled',
  'APPOINTMENT_REMINDER': 'Reminder',
  'BOOKING_RESCHEDULED': 'Visit moved',
  'BOOKING_DISRUPTED': 'Visit disrupted',
  'QUEUE_MOVED': 'Queue moved',
  'BOOKING_DECLINED': 'Request declined',
  'TICKET_CONFIRMATION': 'Queue ticket',
};

/// The unit's message log for one day, failures first (web: Messages.tsx,
/// FR-MSG-05), each naming the patient and the number on file now, so the
/// desk can phone the ones a reminder did not reach.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  String day = ClinicClock.isoDate(DateTime.now());
  Map<String, dynamic>? log;
  String? failure;
  String? state;
  int page = 0;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final asked = day;
    try {
      final r = await widget.store.api.get(
        '/clinics/${Uri.encodeComponent(widget.store.clinicId ?? '')}/messages?day=$day',
      );
      if (mounted && asked == day) setState(() => log = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  void move(String to) {
    setState(() {
      day = to;
      log = null;
      page = 0;
    });
    load();
  }

  static const _state = {
    'FAILED': ('Failed', StaffTone.cancelled),
    'DELIVERED': ('Delivered', StaffTone.confirmed),
    'SENT': ('Sent', StaffTone.booked),
    'CANCELLED': ('Not sent', StaffTone.neutral),
  };

  @override
  Widget build(BuildContext context) {
    final today = ClinicClock.isoDate(DateTime.now());
    final all = (log?['messages'] as List? ?? const []).cast<Map<String, dynamic>>();
    const order = ['FAILED', 'SENT', 'DELIVERED', 'CANCELLED'];
    final sorted = [...all]
      ..sort((a, b) => order.indexOf('${a['deliveryState']}').compareTo(order.indexOf('${b['deliveryState']}')));
    final shown = state == null ? sorted : sorted.where((m) => m['deliveryState'] == state).toList();
    final pages = Pages(shown, phonePage, page);
    final counts = <String, int>{};
    for (final m in all) {
      counts['${m['deliveryState']}'] = (counts['${m['deliveryState']}'] ?? 0) + 1;
    }
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Messages',
              sub:
                  '${widget.store.directory?.clinic(widget.store.clinicId)?.name ?? 'Your unit'} · what went out, failures first',
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: DateBar(
              label: day == today
                  ? 'Today · ${ClinicClock.day(ClinicClock.onDate(day))}'
                  : ClinicClock.long(ClinicClock.onDate(day)),
              onPrevious: () => move(ClinicClock.shiftDate(day, -1)),
              onNext: () => move(ClinicClock.shiftDate(day, 1)),
              onToday: day == today ? null : () => move(today),
            ),
          ),
          const SizedBox(height: 12),
          ChipRow(
            options: [
              for (final k in order)
                if ((counts[k] ?? 0) > 0) FilterOption(id: k, label: _state[k]!.$1, count: counts[k]),
            ],
            value: state,
            allLabel: 'All',
            onChange: (v) => setState(() {
              state = v;
              page = 0;
            }),
          ),
          const SizedBox(height: 12),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (log == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else if (shown.isEmpty)
            Text(
              'Nothing sent on this day.',
              textAlign: TextAlign.center,
              style: AtriaType.body(color: AtriaColors.inkMuted),
            )
          else ...[
            for (final m in pages.shown) ...[
              Glass(
                radius: 20,
                onTap: m['appointmentId'] == null ? null : () => context.go('/console/visits/${m['appointmentId']}'),
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            (m['person'] as Map?)?['name'] as String? ?? 'Patient',
                            style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.ink900),
                          ),
                        ),
                        StateChip(
                          (_state[m['deliveryState']] ?? ('${m['deliveryState']}', StaffTone.neutral)).$1,
                          (_state[m['deliveryState']] ?? ('', StaffTone.neutral)).$2,
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      [
                        kindLabel[m['kind']] ?? '${m['kind']}',
                        m['channel'] == 'SMS' ? 'SMS' : 'Email',
                        if (m['settledAt'] != null) ClinicClock.time(DateTime.parse('${m['settledAt']}')),
                        (m['person'] as Map?)?['phoneE164'] as String?,
                      ].whereType<String>().join(' · '),
                      style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                    ),
                    if (m['failureReason'] != null) ...[
                      const SizedBox(height: 4),
                      Text('${m['failureReason']}', style: AtriaType.body(size: 12, color: AtriaColors.cancelledInk)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
            Pager.of(
              pages,
              noun: 'messages',
              onPrevious: () => setState(() => page--),
              onNext: () => setState(() => page++),
            ),
          ],
        ],
      ),
    );
  }
}

/// The unit's week (web: Reports.tsx, FR-MSR-01, FR-MSR-02, FR-MSR-07): the
/// visits by what became of them, attendance by how patients booked and by
/// their reminder, and the fee ledger as a record of entitlement.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  String week = mondayOf(ClinicClock.isoDate(DateTime.now()));
  Map<String, dynamic>? found;
  String? failure;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final asked = week;
    try {
      final r = await widget.store.api.get(
        '/clinics/${Uri.encodeComponent(widget.store.clinicId ?? '')}/report?week=$week',
      );
      if (mounted && asked == week) setState(() => found = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  void move(int weeks) {
    setState(() {
      week = ClinicClock.shiftDate(week, 7 * weeks);
      found = null;
    });
    load();
  }

  static const _channel = {'ONLINE': 'Online', 'WALK_IN': 'At the desk', 'PHONE': 'By phone', 'REFERRAL': 'Referred'};
  static const _reminder = {'SENT': 'Reminder sent', 'FAILED': 'Reminder failed', 'NOT_SENT': 'No reminder'};
  static const _entitlement = {'FULL': 'Full entitlement', 'PARTIAL': 'Partial entitlement', 'NONE': 'No entitlement'};

  String pct(Object? rate) => rate == null ? 'Not yet' : '${((rate as num) * 100).round()}%';

  @override
  Widget build(BuildContext context) {
    final f = found;
    final thisWeek = mondayOf(ClinicClock.isoDate(DateTime.now()));
    Widget rateRows(String title, List<Map> rows, String Function(Map) name) => Glass(
      radius: 24,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: AtriaType.display(size: 16, weight: FontWeight.w600)),
          const SizedBox(height: 10),
          if (rows.isEmpty) Text('No visits this week.', style: AtriaType.body(size: 13, color: AtriaColors.inkSoft)),
          for (final r in rows) ...[
            Row(
              children: [
                Expanded(
                  child: Text(name(r), style: AtriaType.body(size: 13.5, color: AtriaColors.ink900)),
                ),
                Text(
                  '${pct(r['attendance'])} · ${r['attended']} of ${r['booked']}',
                  style: AtriaType.body(size: 12.5, weight: FontWeight.w700, color: AtriaColors.ink800),
                ),
              ],
            ),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: ((r['attendance'] as num?) ?? 0).toDouble(),
                minHeight: 6,
                backgroundColor: AtriaColors.surfaceField,
                color: AtriaColors.blue500,
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
    final ledger = f?['ledger'] as Map?;
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Reports',
              sub: '${widget.store.directory?.clinic(widget.store.clinicId)?.name ?? 'Your unit'} · the week',
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: DateBar(
              label:
                  '${ClinicClock.day(ClinicClock.onDate(week))} to ${ClinicClock.day(ClinicClock.onDate(ClinicClock.shiftDate(week, 6)))}',
              onPrevious: () => move(-1),
              onNext: () => move(1),
              onToday: week == thisWeek
                  ? null
                  : () {
                      setState(() {
                        week = thisWeek;
                        found = null;
                      });
                      load();
                    },
            ),
          ),
          const SizedBox(height: 14),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (f == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else ...[
            GridView.count(
              crossAxisCount: context.isTablet ? 4 : 2,
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: context.isTablet ? 2.6 : 2.05,
              children: [
                FigureTile(
                  icon: 'calendar',
                  value: (f['booked'] as num?)?.toInt() ?? 0,
                  label: 'Booked',
                  colours: toneBlue,
                ),
                FigureTile(
                  icon: 'check',
                  value: (f['attended'] as num?)?.toInt() ?? 0,
                  label: 'Attended',
                  colours: toneGreen,
                ),
                FigureTile(
                  icon: 'alert',
                  value: (f['noShow'] as num?)?.toInt() ?? 0,
                  label: 'No-shows',
                  colours: toneAmber,
                ),
                FigureTile(
                  icon: 'close',
                  value: (f['cancelled'] as num?)?.toInt() ?? 0,
                  label: '${f['lateCancelled'] ?? 0} late cancellations',
                  colours: toneRed,
                ),
              ],
            ),
            const SizedBox(height: 14),
            rateRows(
              'Attendance by how they booked',
              (f['byChannel'] as List? ?? const []).cast<Map>(),
              (r) => _channel[r['channel']] ?? '${r['channel']}',
            ),
            const SizedBox(height: 14),
            rateRows(
              'Attendance by reminder',
              (f['byReminder'] as List? ?? const []).cast<Map>(),
              (r) => _reminder[r['reminder']] ?? '${r['reminder']}',
            ),
            if (ledger != null) ...[
              const SizedBox(height: 14),
              Glass(
                radius: 24,
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Fee ledger', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                    Text(
                      'A record of entitlement, not money moved.',
                      style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                    ),
                    const SizedBox(height: 10),
                    for (final e in (ledger['byEntitlement'] as List? ?? const []).cast<Map>())
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                _entitlement[e['entitlement']] ?? '${e['entitlement']}',
                                style: AtriaType.body(size: 13.5, color: AtriaColors.ink900),
                              ),
                            ),
                            Text(
                              '${e['entries']} · ${e['amountMinor']} ${ledger['currency'] ?? 'XAF'}',
                              style: AtriaType.body(size: 12.5, weight: FontWeight.w700, color: AtriaColors.ink800),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

const actionLabel = {
  'appointment.read': 'Opened a visit',
  'appointment.create': 'Booked a visit',
  'appointment.cancel': 'Cancelled a visit',
  'appointment.reschedule': 'Moved a visit',
  'appointment.confirm': 'Confirmed a visit',
  'appointment.arrive': 'Recorded an arrival',
  'appointment.start': 'Started a consultation',
  'appointment.complete': 'Completed a visit',
  'appointment.no_show': 'Marked a no-show',
  'schedule.day': "Viewed a unit's day",
  'schedule.calendar': 'Viewed a calendar',
  'availability.hours': 'Changed working hours',
  'availability.time_off': 'Took time off',
  'availability.give_back': 'Gave back time off',
  'patient.read': 'Opened a patient record',
  'patient.search': 'Searched the register',
  'patient.create': 'Registered a patient',
};

/// The audit log (web: AuditLog.tsx, FR-ADM-04, FR-ADM-05): who opened or
/// changed what in the unit, newest first. A row says how many patients an
/// action touched, never who they were.
class AuditScreen extends StatefulWidget {
  const AuditScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends State<AuditScreen> {
  String period = '7';
  String? kind;
  final cursors = <String?>[null];
  Map<String, dynamic>? found;
  String? failure;

  @override
  void initState() {
    super.initState();
    load();
  }

  String day(int back) => ClinicClock.isoDate(DateTime.now().subtract(Duration(days: back)));

  Future<void> load() async {
    setState(() => found = null);
    final ask = {
      'from': day(int.parse(period) - 1),
      'to': day(0),
      'limit': '$phonePage',
      'kind': ?kind,
      'cursor': ?cursors.last,
    };
    try {
      final r = await widget.store.api.get('/audit?${Uri(queryParameters: ask).query}');
      if (mounted) setState(() => found = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  void reset() {
    cursors
      ..clear()
      ..add(null);
    load();
  }

  @override
  Widget build(BuildContext context) {
    final entries = (found?['entries'] as List? ?? const []).cast<Map<String, dynamic>>();
    final next = found?['nextCursor'] as String?;
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          const Rise(
            child: StaffHeader(title: 'Audit log', sub: 'Who opened or changed what in your unit'),
          ),
          const SizedBox(height: 16),
          ChipRow(
            options: const [
              FilterOption(id: '7', label: 'Last 7 days'),
              FilterOption(id: '30', label: 'Last 30 days'),
            ],
            value: period == '1' ? null : period,
            allLabel: 'Today',
            onChange: (v) {
              setState(() => period = v ?? '1');
              reset();
            },
          ),
          const SizedBox(height: 8),
          ChipRow(
            options: const [
              FilterOption(id: 'READ', label: 'Opened'),
              FilterOption(id: 'WRITE', label: 'Changed'),
            ],
            value: kind,
            allLabel: 'Anything',
            onChange: (v) {
              setState(() => kind = v);
              reset();
            },
          ),
          const SizedBox(height: 12),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (found == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else if (entries.isEmpty)
            Text(
              'Nothing recorded for this period.',
              textAlign: TextAlign.center,
              style: AtriaType.body(color: AtriaColors.inkMuted),
            )
          else ...[
            for (final e in entries) ...[
              Glass(
                radius: 20,
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            actionLabel[e['action']] ?? '${e['action']}',
                            style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.ink900),
                          ),
                          Text(
                            [
                              '${e['actorName']}',
                              ?_roleName[e['actorRole']],
                              '${ClinicClock.day(DateTime.parse('${e['occurredAt']}'))}, ${ClinicClock.time(DateTime.parse('${e['occurredAt']}'))}',
                              if (((e['patientCount'] as num?) ?? 0) > 0)
                                '${e['patientCount']} ${e['patientCount'] == 1 ? 'patient' : 'patients'}',
                            ].where((s) => s.isNotEmpty).join(' · '),
                            style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                          ),
                        ],
                      ),
                    ),
                    StateChip(
                      e['kind'] == 'WRITE' ? 'Change' : 'Read',
                      e['kind'] == 'WRITE' ? StaffTone.awaiting : StaffTone.booked,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(
                  onPressed: cursors.length > 1
                      ? () {
                          cursors.removeLast();
                          load();
                        }
                      : null,
                  child: const Text('Newer'),
                ),
                Text('Page ${cursors.length}', style: AtriaType.body(size: 12.5, color: AtriaColors.inkMuted)),
                TextButton(
                  onPressed: next == null
                      ? null
                      : () {
                          cursors.add(next);
                          load();
                        },
                  child: const Text('Older'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

const _roleName = {
  'RECEPTIONIST': 'Front desk',
  'CLINICIAN': 'Clinician',
  'CLINIC_MANAGER': 'Unit manager',
  'TENANT_ADMIN': 'Administrator',
};
