import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/filters.dart';
import '../ui/layout.dart';
import '../ui/loading.dart';
import '../ui/search.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// The day (web: DaySchedule.tsx, FR-STF-01): the unit's whole day for the
/// desk and the manager, a clinician's own. The figures, a search, one row of
/// clinicians or states, and the visits paged; a visit opens its page.
class DayScheduleScreen extends StatefulWidget {
  const DayScheduleScreen({super.key, required this.store, this.date, this.clinician});
  final StaffStore store;
  final String? date;
  final String? clinician;

  @override
  State<DayScheduleScreen> createState() => _DayScheduleScreenState();
}

class _DayScheduleScreenState extends State<DayScheduleScreen> {
  late String date = widget.date ?? ClinicClock.isoDate(DateTime.now());
  Schedule? schedule;
  String? failure;
  String query = '';
  String? clinician;
  String? status;
  int page = 0;
  final search = TextEditingController();

  @override
  void initState() {
    super.initState();
    clinician = widget.clinician;
    load();
  }

  late int seen = widget.store.revision;

  @override
  void didUpdateWidget(DayScheduleScreen old) {
    super.didUpdateWidget(old);
    if (widget.store.revision != seen) {
      seen = widget.store.revision;
      load();
    }
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    final asked = date;
    try {
      final found = await widget.store.schedule(date);
      if (mounted && asked == date) {
        setState(() {
          schedule = found;
          failure = null;
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  void move(String to) {
    setState(() {
      date = to;
      schedule = null;
      page = 0;
    });
    load();
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final dir = store.directory;
    final s = schedule;
    final today = ClinicClock.isoDate(DateTime.now());
    final all = s?.appointments ?? const <Appointment>[];
    final theirs = clinician == null ? all : all.where((a) => a.clinicianId == clinician).toList();
    String statusOf(Appointment a) => cancelledStates.contains(a.state) ? 'cancelled' : 'booked';
    String textOf(Appointment a) => [
      s?.nameOf(a) ?? '',
      a.reference,
      dir?.clinician(a.clinicianId)?.name ?? '',
      dir?.type(a.typeId)?.name ?? '',
    ].join(' ');
    final found = theirs
        .where((a) => (status == null || statusOf(a) == status) && (query.trim().isEmpty || rank(textOf(a), query) > 0))
        .toList();
    final figures = tally(theirs);
    final pages = Pages(found, phonePage, page);
    final unit = dir?.clinic(store.clinicId);
    final clinicianOptions = countBy(
      all.where((a) => a.clinicianId != null),
      (a) => a.clinicianId!,
    ).map((o) => FilterOption(id: o.id, label: dir?.clinician(o.id)?.name ?? 'Clinician', count: o.count)).toList();

    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Schedule',
              sub: store.ownCalendar
                  ? 'Your day · ${roleLabel[store.role]}'
                  : '${unit?.name ?? 'Your unit'} · ${roleLabel[store.role]}',
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: Segmented(
              labels: const ['Day', 'Week'],
              selected: 0,
              onChanged: (i) => i == 1 ? context.go('/console/week?date=$date') : null,
            ),
          ),
          const SizedBox(height: 12),
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
          Rise(
            index: 2,
            child: GridView.count(
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
                  value: figures.booked,
                  label: date == today ? 'Booked today' : 'Booked',
                  colours: toneBlue,
                ),
                FigureTile(icon: 'clock', value: figures.ahead, label: 'Still to come', colours: toneGreen),
                FigureTile(
                  icon: 'close',
                  value: figures.cancelled,
                  label: date == today ? 'Cancelled today' : 'Cancelled',
                  colours: toneRed,
                ),
                FigureTile(icon: 'bell', value: figures.reminders, label: 'Reminders to send', colours: toneAmber),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Rise(
            index: 3,
            child: SearchSuggest(
              controller: search,
              groups: const [],
              placeholder: 'Search patients, references',
              onChanged: (v) => setState(() {
                query = v;
                page = 0;
              }),
            ),
          ),
          const SizedBox(height: 12),
          if (!store.ownCalendar && clinicianOptions.length > 1)
            Rise(
              index: 3,
              child: ChipRow(
                options: clinicianOptions,
                value: clinician,
                allLabel: 'All clinicians',
                onChange: (v) => setState(() {
                  clinician = v;
                  page = 0;
                }),
              ),
            ),
          const SizedBox(height: 8),
          Rise(
            index: 3,
            child: ChipRow(
              options: [
                FilterOption(id: 'booked', label: 'Booked', count: theirs.where((a) => statusOf(a) == 'booked').length),
                FilterOption(
                  id: 'cancelled',
                  label: 'Cancelled',
                  count: theirs.where((a) => statusOf(a) == 'cancelled').length,
                ),
              ],
              value: status,
              allLabel: 'Any status',
              onChange: (v) => setState(() {
                status = v;
                page = 0;
              }),
            ),
          ),
          const SizedBox(height: 14),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (s == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading the day')),
            )
          else if (found.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 30),
              child: Text(
                all.isEmpty ? 'Nothing booked on this day.' : 'No visit matches.',
                textAlign: TextAlign.center,
                style: AtriaType.body(color: AtriaColors.inkMuted),
              ),
            )
          else ...[
            for (final (i, a) in pages.shown.indexed) ...[
              if (i > 0) const SizedBox(height: 9),
              Rise(
                index: 4 + i,
                child: VisitLine(
                  appointment: a,
                  name: s.nameOf(a),
                  detail: [
                    dir?.type(a.typeId)?.name,
                    if (!store.ownCalendar) dir?.clinician(a.clinicianId)?.name,
                    a.reference,
                  ].whereType<String>().join(' · '),
                  onTap: () => context.go('/console/visits/${a.id}'),
                ),
              ),
            ],
            const SizedBox(height: 10),
            Pager.of(pages, onPrevious: () => setState(() => page--), onNext: () => setState(() => page++)),
          ],
        ],
      ),
    );
  }
}

/// Counts by a key, most first.
List<({String id, int count})> countBy<T>(Iterable<T> items, String Function(T) key) {
  final counts = <String, int>{};
  for (final i in items) {
    counts[key(i)] = (counts[key(i)] ?? 0) + 1;
  }
  return [for (final e in counts.entries) (id: e.key, count: e.value)]..sort((a, b) => b.count - a.count);
}

/// The week (web: WeekView.tsx, FR-STF-02): Monday to Sunday, each day with
/// its visits, a tap away from the visit or the day.
class WeekScreen extends StatefulWidget {
  const WeekScreen({super.key, required this.store, this.date});
  final StaffStore store;
  final String? date;

  @override
  State<WeekScreen> createState() => _WeekScreenState();
}

class _WeekScreenState extends State<WeekScreen> {
  late String monday = mondayOf(widget.date ?? ClinicClock.isoDate(DateTime.now()));
  Schedule? schedule;
  String? failure;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final asked = monday;
    try {
      final found = await widget.store.schedule(monday, ClinicClock.shiftDate(monday, 6));
      if (mounted && asked == monday) setState(() => schedule = found);
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  void move(int weeks) {
    setState(() {
      monday = ClinicClock.shiftDate(monday, 7 * weeks);
      schedule = null;
    });
    load();
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final dir = store.directory;
    final s = schedule;
    final today = ClinicClock.isoDate(DateTime.now());
    final sunday = ClinicClock.shiftDate(monday, 6);
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
        children: [
          Rise(
            child: StaffHeader(
              title: 'Schedule',
              sub: store.ownCalendar ? 'Your week' : '${dir?.clinic(store.clinicId)?.name ?? 'Your unit'} · the week',
            ),
          ),
          const SizedBox(height: 16),
          Rise(
            index: 1,
            child: Segmented(
              labels: const ['Day', 'Week'],
              selected: 1,
              onChanged: (i) => i == 0
                  ? context.go(
                      '/console?date=${monday.compareTo(today) <= 0 && today.compareTo(sunday) <= 0 ? today : monday}',
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          Rise(
            index: 1,
            child: DateBar(
              label: '${ClinicClock.day(ClinicClock.onDate(monday))} to ${ClinicClock.day(ClinicClock.onDate(sunday))}',
              onPrevious: () => move(-1),
              onNext: () => move(1),
              onToday: mondayOf(today) == monday
                  ? null
                  : () {
                      setState(() {
                        monday = mondayOf(today);
                        schedule = null;
                      });
                      load();
                    },
            ),
          ),
          const SizedBox(height: 16),
          if (failure != null)
            Notice(failure!, tone: NoticeTone.error)
          else if (s == null)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: LoadingIndicator(label: 'Loading the week')),
            )
          else
            for (var d = 0; d < 7; d++)
              Builder(
                builder: (context) {
                  final day = ClinicClock.shiftDate(monday, d);
                  final visits = s.appointments.where((a) => ClinicClock.isoDate(a.startAt) == day).toList();
                  final live = visits.where((a) => !cancelledStates.contains(a.state)).length;
                  return Rise(
                    index: 2 + d,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SectionHead(
                            title: '${ClinicClock.day(ClinicClock.onDate(day))}${day == today ? ' · Today' : ''}',
                            link: visits.isEmpty ? null : '$live booked',
                            onLink: () => context.go('/console?date=$day'),
                          ),
                          const SizedBox(height: 8),
                          if (visits.isEmpty)
                            Text('Nothing booked.', style: AtriaType.body(size: 13, color: AtriaColors.inkSoft))
                          else
                            for (final (i, a) in visits.indexed) ...[
                              if (i > 0) const SizedBox(height: 8),
                              VisitLine(
                                appointment: a,
                                name: s.nameOf(a),
                                detail: [
                                  dir?.type(a.typeId)?.name,
                                  if (!store.ownCalendar) dir?.clinician(a.clinicianId)?.name,
                                ].whereType<String>().join(' · '),
                                onTap: () => context.go('/console/visits/${a.id}'),
                              ),
                            ],
                        ],
                      ),
                    ),
                  );
                },
              ),
        ],
      ),
    );
  }
}
