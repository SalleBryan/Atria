import 'package:flutter/material.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/filters.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/loading.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// The unit's clinicians on a day (web: Roster.tsx, FR-STF-08): who is on
/// shift, their hours, any time off, and how full their day is.
class RosterScreen extends StatefulWidget {
  const RosterScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<RosterScreen> createState() => _RosterScreenState();
}

class _RosterScreenState extends State<RosterScreen> {
  String date = ClinicClock.isoDate(DateTime.now());
  Map<String, dynamic>? roster;
  String? failure;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final asked = date;
    try {
      final r = await widget.store.api.get(
        '/clinics/${Uri.encodeComponent(widget.store.clinicId ?? '')}/roster?date=$date',
      );
      if (mounted && asked == date) setState(() => roster = r);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  void move(String to) {
    setState(() {
      date = to;
      roster = null;
    });
    load();
  }

  static const _status = {
    'ON_SHIFT': ('On shift', StaffTone.confirmed),
    'LATER': ('Starts later', StaffTone.booked),
    'SCHEDULED': ('Working', StaffTone.booked),
    'FINISHED': ('Finished', StaffTone.neutral),
    'OFF': ('Day off', StaffTone.neutral),
    'LEAVE': ('On leave', StaffTone.awaiting),
    'UNAVAILABLE': ('Unavailable', StaffTone.cancelled),
  };

  @override
  Widget build(BuildContext context) {
    final today = ClinicClock.isoDate(DateTime.now());
    final rows = (roster?['clinicians'] as List? ?? const []).cast<Map<String, dynamic>>();
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Roster',
              sub:
                  '${widget.store.directory?.clinic(widget.store.clinicId)?.name ?? 'Your unit'} · who works, and how full',
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: DateBar(
              label: date == today
                  ? 'Today · ${ClinicClock.day(ClinicClock.onDate(date))}'
                  : ClinicClock.long(ClinicClock.onDate(date)),
              onPrevious: () => move(ClinicClock.shiftDate(date, -1)),
              onNext: () => move(ClinicClock.shiftDate(date, 1)),
              onToday: date == today ? null : () => move(today),
            ),
          ),
          const SizedBox(height: 14),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (roster == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else if (rows.isEmpty)
            Text(
              'No clinician in the unit.',
              textAlign: TextAlign.center,
              style: AtriaType.body(color: AtriaColors.inkMuted),
            )
          else
            for (final (i, r) in rows.indexed) ...[
              if (i > 0) const SizedBox(height: 10),
              Rise(
                index: 2 + i,
                child: _Row(r: r, status: _status[r['status']] ?? ('${r['status']}', StaffTone.neutral)),
              ),
            ],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.r, required this.status});
  final Map<String, dynamic> r;
  final (String, StaffTone) status;

  @override
  Widget build(BuildContext context) {
    final load = (r['load'] as num?)?.toDouble();
    final name = 'Dr ${[r['givenName'], r['familyName']].whereType<String>().join(' ')}';
    final off = (r['timeOff'] as List? ?? const []).cast<Map>();
    final starts = r['startsAt'] as String?;
    final ends = r['endsAt'] as String?;
    return Glass(
      radius: 22,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Initials(initials(r['givenName'] as String?, r['familyName'] as String?)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                    ),
                    Text(
                      [
                        r['specialty'] as String?,
                        starts == null ? 'Not working' : '$starts to $ends',
                      ].whereType<String>().join(' · '),
                      style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                    ),
                  ],
                ),
              ),
              StateChip(status.$1, status.$2),
            ],
          ),
          if (off.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final t in off)
              Text(
                '${t['kind'] == 'LEAVE'
                    ? 'Leave'
                    : t['kind'] == 'UNAVAILABLE'
                    ? 'Unavailable'
                    : 'Blocked'}${t['startTime'] == null ? ', all day' : ', ${t['startTime']} to ${t['endTime']}'}',
                style: AtriaType.body(size: 12, color: AtriaColors.awaitingInk),
              ),
          ],
          if (load != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: load.clamp(0, 1),
                minHeight: 7,
                backgroundColor: AtriaColors.surfaceField,
                color: load >= .9 ? AtriaColors.awaiting : AtriaColors.blue500,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${r['visits']} visits · ${(load * 100).round()}% of their hours booked',
              style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft),
            ),
          ],
        ],
      ),
    );
  }
}

const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/// A clinician's working week and time off (web: Availability.tsx,
/// FR-DIR-03 to FR-DIR-05, FR-STF-10): a clinician edits their own, a unit
/// manager any in the unit, the desk reads them and marks one unavailable.
class AvailabilityScreen extends StatefulWidget {
  const AvailabilityScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<AvailabilityScreen> createState() => _AvailabilityScreenState();
}

class _AvailabilityScreenState extends State<AvailabilityScreen> {
  String? chosen;
  Map<String, dynamic>? found;
  Map<String, ({bool on, String start, String end})> week = {};
  String? failure;
  bool saving = false;

  StaffStore get store => widget.store;
  bool get writes => store.role == StaffRole.clinician || store.role == StaffRole.manager;

  List<Clinician> get colleagues {
    final all = store.directory?.clinicians ?? const <Clinician>[];
    return store.role == StaffRole.clinician
        ? all.where((c) => c.id == store.me.staffId).toList()
        : all.where((c) => c.clinicId == store.me.clinicId).toList();
  }

  String? get clinicianId =>
      chosen ?? (store.role == StaffRole.clinician ? store.me.staffId : colleagues.firstOrNull?.id);

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final id = clinicianId;
    if (id == null) return;
    setState(() => found = null);
    try {
      final r = await store.api.get('/clinicians/${Uri.encodeComponent(id)}/availability');
      final hours = (r['usesUnitHours'] == true ? r['unitHours'] : r['hours']) as Map? ?? const {};
      if (!mounted || id != clinicianId) return;
      setState(() {
        found = r;
        week = {
          for (var d = 0; d < 7; d++)
            '$d': (
              on: hours['$d'] != null,
              start: (hours['$d'] as Map?)?['start'] as String? ?? '08:00',
              end: (hours['$d'] as Map?)?['end'] as String? ?? '16:00',
            ),
        };
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> saveHours() async {
    setState(() {
      saving = true;
      failure = null;
    });
    try {
      await store.api.send('PUT', '/clinicians/${Uri.encodeComponent(clinicianId!)}/hours', {
        'days': {
          for (final e in week.entries) e.key: e.value.on ? {'start': e.value.start, 'end': e.value.end} : null,
        },
      });
      if (mounted) say(context, 'Working hours saved. New bookings follow them from now.');
      await load();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = '${sentence(e.message)} Nothing was changed.');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> giveBack(Map t) async {
    try {
      await store.api.send(
        'DELETE',
        '/clinicians/${Uri.encodeComponent(clinicianId!)}/time-off/${Uri.encodeComponent('${t['groupId']}')}',
      );
      if (mounted) say(context, 'Time given back. It can be booked again.');
      load();
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = sentence(e.message));
    }
  }

  Future<void> addTimeOff() async {
    final said = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _TimeOff(
        api: store.api,
        clinicianId: clinicianId!,
        kinds: [
          if (writes) ...['BLOCK', 'LEAVE'],
          'UNAVAILABLE',
        ],
      ),
    );
    if (said != null && mounted) {
      say(context, said);
      load();
    }
  }

  Future<String?> pickTime(String current) => showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    backgroundColor: AtriaColors.surfacePanel,
    builder: (context) => SafeArea(
      child: SizedBox(
        height: 320,
        child: ListView(
          children: [
            for (var h = 6; h <= 21; h++)
              for (final m in ['00', '30'])
                ListTile(
                  title: Text('${h.toString().padLeft(2, '0')}:$m'),
                  trailing: current == '${h.toString().padLeft(2, '0')}:$m'
                      ? const AtriaIcon('checkMark', color: AtriaColors.blue600)
                      : null,
                  onTap: () => Navigator.pop(context, '${h.toString().padLeft(2, '0')}:$m'),
                ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final f = found;
    final off = (f?['timeOff'] as List? ?? const []).cast<Map>();
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Availability',
              sub: store.role == StaffRole.clinician
                  ? 'Your working week and time off.'
                  : "Working hours and time off for the unit's clinicians.",
            ),
          ),
          if (store.role != StaffRole.clinician && colleagues.length > 1) ...[
            const SizedBox(height: 14),
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final c in colleagues)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChipButton(
                        label: c.name,
                        on: c.id == clinicianId,
                        onTap: () {
                          setState(() => chosen = c.id);
                          load();
                        },
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          if (failure != null) ...[Notice(failure!, tone: NoticeTone.error), const SizedBox(height: 12)],
          if (f == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading')),
            )
          else ...[
            Glass(
              radius: 26,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Working week', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text(
                    f['usesUnitHours'] == true
                        ? "Following the unit's opening hours. Save to give this clinician hours of their own."
                        : 'Hours of their own. A day left off is a day off.',
                    style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                  ),
                  const SizedBox(height: 10),
                  for (var d = 0; d < 7; d++)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 96,
                            child: Text(
                              _weekdays[d],
                              style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: AtriaColors.ink900),
                            ),
                          ),
                          Switch(
                            value: week['$d']!.on,
                            onChanged: writes
                                ? (v) => setState(
                                    () => week['$d'] = (on: v, start: week['$d']!.start, end: week['$d']!.end),
                                  )
                                : null,
                          ),
                          const Spacer(),
                          if (week['$d']!.on) ...[
                            TextButton(
                              onPressed: writes
                                  ? () async {
                                      final t = await pickTime(week['$d']!.start);
                                      if (t != null)
                                        setState(() => week['$d'] = (on: true, start: t, end: week['$d']!.end));
                                    }
                                  : null,
                              child: Text(week['$d']!.start),
                            ),
                            const Text('to'),
                            TextButton(
                              onPressed: writes
                                  ? () async {
                                      final t = await pickTime(week['$d']!.end);
                                      if (t != null)
                                        setState(() => week['$d'] = (on: true, start: week['$d']!.start, end: t));
                                    }
                                  : null,
                              child: Text(week['$d']!.end),
                            ),
                          ] else
                            Text('Day off', style: AtriaType.body(size: 13, color: AtriaColors.inkSoft)),
                        ],
                      ),
                    ),
                  if (writes) ...[
                    const SizedBox(height: 10),
                    PrimaryButton(label: 'Save hours', busy: saving, onPressed: saveHours),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            Glass(
              radius: 26,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('Time off', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                      ),
                      TextButton(onPressed: addTimeOff, child: const Text('Add')),
                    ],
                  ),
                  if (off.isEmpty)
                    Text('None planned.', style: AtriaType.body(size: 13, color: AtriaColors.inkSoft))
                  else
                    for (final t in off)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    t['kind'] == 'LEAVE'
                                        ? 'Leave'
                                        : t['kind'] == 'UNAVAILABLE'
                                        ? 'Unavailable'
                                        : 'Blocked',
                                    style: AtriaType.body(
                                      size: 13.5,
                                      weight: FontWeight.w700,
                                      color: AtriaColors.ink900,
                                    ),
                                  ),
                                  Text(
                                    [
                                      t['from'] == t['to']
                                          ? ClinicClock.day(ClinicClock.onDate('${t['from']}'))
                                          : '${ClinicClock.day(ClinicClock.onDate('${t['from']}'))} to ${ClinicClock.day(ClinicClock.onDate('${t['to']}'))}',
                                      t['startTime'] == null ? 'all day' : '${t['startTime']} to ${t['endTime']}',
                                      if ((t['reason'] as String? ?? '').isNotEmpty) '${t['reason']}',
                                    ].join(' · '),
                                    style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                                  ),
                                ],
                              ),
                            ),
                            if (writes) TextButton(onPressed: () => giveBack(t), child: const Text('Give back')),
                          ],
                        ),
                      ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TimeOff extends StatefulWidget {
  const _TimeOff({required this.api, required this.clinicianId, required this.kinds});
  final Api api;
  final String clinicianId;
  final List<String> kinds;

  @override
  State<_TimeOff> createState() => _TimeOffState();
}

class _TimeOffState extends State<_TimeOff> {
  late String kind = widget.kinds.first;
  String from = ClinicClock.isoDate(DateTime.now());
  late String to = from;
  bool wholeDay = false;
  String start = '08:00';
  String end = '12:00';
  final reason = TextEditingController();
  bool busy = false;
  String? failure;

  static const _labels = {'BLOCK': 'Block time', 'LEAVE': 'Leave', 'UNAVAILABLE': 'Unavailable'};
  static const _hints = {
    'BLOCK': 'Free time taken out of booking. Refused where a visit is booked.',
    'LEAVE': 'Whole days. Visits inside are disrupted and each patient asked to choose again.',
    'UNAVAILABLE': 'Visits inside are disrupted and each patient asked to choose again.',
  };

  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  Future<void> save() async {
    setState(() {
      busy = true;
      failure = null;
    });
    final leave = kind == 'LEAVE';
    final whole = leave || wholeDay;
    try {
      final done = await widget.api.send('POST', '/clinicians/${Uri.encodeComponent(widget.clinicianId)}/time-off', {
        'kind': kind,
        'reason': reason.text.trim(),
        if (leave) ...{'from': from, 'to': to} else 'date': from,
        if (!whole) ...{'startTime': start, 'endTime': end},
      });
      final count = (done['disrupted'] as List? ?? const []).length;
      if (mounted) {
        Navigator.pop(
          context,
          count > 0
              ? 'Time off recorded. $count ${count == 1 ? 'visit was' : 'visits were'} disrupted, and each patient emailed to choose a new time.'
              : 'Time off recorded. No visits were affected.',
        );
      }
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was changed.';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final leave = kind == 'LEAVE';
    List<String> times() => [
      for (var h = 6; h <= 21; h++)
        for (final m in ['00', '30']) '${h.toString().padLeft(2, '0')}:$m',
    ];
    Widget timeRow(String label, String value, ValueChanged<String> set) => Row(
      children: [
        SizedBox(
          width: 60,
          child: Text(label, style: AtriaType.body(size: 13, color: AtriaColors.inkMuted)),
        ),
        Expanded(
          child: SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              controller: ScrollController(initialScrollOffset: (times().indexOf(value) * 70.0 - 40).clamp(0, 9999)),
              children: [
                for (final t in times())
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: FilterChipButton(label: t, on: t == value, onTap: () => setState(() => set(t))),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
          children: [
            Text('Time off', style: AtriaType.display(size: 21)),
            const SizedBox(height: 12),
            Segmented(
              labels: [for (final k in widget.kinds) _labels[k]!],
              selected: widget.kinds.indexOf(kind),
              onChanged: (i) => setState(() => kind = widget.kinds[i]),
            ),
            const SizedBox(height: 8),
            Text(_hints[kind]!, style: AtriaType.body(size: 12, color: AtriaColors.inkSoft)),
            const SizedBox(height: 14),
            DateBar(
              label: leave
                  ? 'From ${ClinicClock.day(ClinicClock.onDate(from))}'
                  : ClinicClock.long(ClinicClock.onDate(from)),
              onPrevious: () => setState(() {
                from = ClinicClock.shiftDate(from, -1);
                if (to.compareTo(from) < 0) to = from;
              }),
              onNext: () => setState(() {
                from = ClinicClock.shiftDate(from, 1);
                if (to.compareTo(from) < 0) to = from;
              }),
            ),
            if (leave) ...[
              const SizedBox(height: 10),
              DateBar(
                label: 'To ${ClinicClock.day(ClinicClock.onDate(to))}',
                onPrevious: () => setState(() {
                  if (to.compareTo(from) > 0) to = ClinicClock.shiftDate(to, -1);
                }),
                onNext: () => setState(() => to = ClinicClock.shiftDate(to, 1)),
              ),
            ] else ...[
              const SizedBox(height: 10),
              AtriaCheckbox(checked: wholeDay, label: 'The whole day', onChanged: (v) => setState(() => wholeDay = v)),
              if (!wholeDay) ...[
                const SizedBox(height: 8),
                timeRow('From', start, (v) => start = v),
                const SizedBox(height: 8),
                timeRow('To', end, (v) => end = v),
              ],
            ],
            const SizedBox(height: 12),
            AtriaField(label: 'Reason, for the unit', icon: 'pencil', controller: reason),
            if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
            const SizedBox(height: 16),
            PrimaryButton(
              label: 'Record time off',
              busy: busy,
              onPressed: leave || wholeDay || start.compareTo(end) < 0 ? save : null,
            ),
          ],
        ),
      ),
    );
  }
}
