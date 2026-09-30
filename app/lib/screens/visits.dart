import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../patient/calendar.dart';
import '../patient/data.dart';
import '../patient/intake.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/widgets.dart';
import '../ui/loading.dart';
import '../ui/expressive.dart';

const _longDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _longMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const _page = 10;

/// To the unit's own door when the hospital has placed it (Clinic.directions).
Future<void> openDirections(Clinic? clinic) async {
  if (clinic == null) return;
  await launchUrl(clinic.directions, mode: LaunchMode.externalApplication);
}

/// "Mobile · My visits" (Figma 36:4): upcoming and past visits, a card each,
/// paged rather than scrolled on for ever (FR-VIS-01).
class VisitsScreen extends StatefulWidget {
  const VisitsScreen({super.key, required this.store, this.past = false});
  final PatientStore store;
  final bool past;

  @override
  State<VisitsScreen> createState() => _VisitsScreenState();
}

class _VisitsScreenState extends State<VisitsScreen> {
  late bool showPast = widget.past;
  int page = 0;
  String? unit;

  Future<void> filter(PatientData data) async {
    final picked = await showModalBottomSheet<String>(
      useRootNavigator: true,
      context: context,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text('Unit', style: AtriaType.display(size: 18, weight: FontWeight.w600)),
            const SizedBox(height: 8),
            for (final c in [null, ...data.clinics.where((c) => data.appointments.any((a) => a.clinicId == c.id))])
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(c?.name ?? 'Every unit', style: AtriaType.body(size: 14.5, color: AtriaColors.ink900)),
                trailing: c?.id == unit ? const AtriaIcon('checkMark', color: AtriaColors.blue600) : null,
                onTap: () => Navigator.pop(context, c?.id ?? ''),
              ),
          ],
        ),
      ),
    );
    if (picked != null) {
      setState(() {
        unit = picked.isEmpty ? null : picked;
        page = 0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.store,
      builder: (context, _) {
        final state = widget.store.state;
        if (state is DataFailed) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: Notice(state.message, tone: NoticeTone.error),
          );
        }
        if (state is! DataReady) return const Center(child: LoadingIndicator());
        final data = state.data;
        final ahead = upcoming(data.appointments);
        final behind = past(data.appointments);
        final all = (showPast ? behind : ahead).where((a) => unit == null || a.clinicId == unit).toList();
        final pages = (all.length / _page).ceil().clamp(1, 999);
        final at = page.clamp(0, pages - 1);
        final shown = all.skip(at * _page).take(_page).toList();
        final attended = behind.where((a) => a.state == 'COMPLETED' || a.state == 'AWAITING_FEEDBACK').length;

        return RefreshIndicator(
          onRefresh: widget.store.reload,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 26, 20, 132),
            children: [
              Rise(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Your visits', style: AtriaType.display(size: 26)),
                          const SizedBox(height: 4),
                          Text(
                            '${ahead.length} upcoming · $attended completed',
                            style: AtriaType.body(size: 13, color: AtriaColors.inkMuted, height: 1.3),
                          ),
                        ],
                      ),
                    ),
                    Glass(
                      radius: 16,
                      height: 46,
                      semanticLabel: 'Filter by unit',
                      onTap: () => filter(data),
                      child: SizedBox(
                        width: 46,
                        child: Center(
                          child: AtriaIcon(
                            'filter',
                            size: 19,
                            color: unit == null ? AtriaColors.ink800 : AtriaColors.blue600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Rise(
                index: 1,
                child: Segmented(
                  labels: const ['Upcoming', 'Past visits'],
                  selected: showPast ? 1 : 0,
                  onChanged: (i) => setState(() {
                    showPast = i == 1;
                    page = 0;
                  }),
                ),
              ),
              const SizedBox(height: 16),
              if (shown.isEmpty)
                Rise(
                  index: 2,
                  child: Glass(
                    radius: 26,
                    padding: const EdgeInsets.all(20),
                    child: Text(
                      showPast
                          ? 'Visits you have been to will be listed here.'
                          : 'Nothing booked yet. Find care to book a visit.',
                      style: AtriaType.body(color: AtriaColors.inkMuted),
                    ),
                  ),
                ),
              for (var i = 0; i < shown.length; i++) ...[
                if (i > 0) const SizedBox(height: 16),
                Rise(
                  index: i + 2,
                  child: VisitCard(appointment: shown[i], data: data, store: widget.store),
                ),
              ],
              if (pages > 1) ...[
                const SizedBox(height: 16),
                _Pager(
                  page: at,
                  pages: pages,
                  first: at * _page + 1,
                  last: at * _page + shown.length,
                  total: all.length,
                  onPage: (p) => setState(() => page = p),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Pager extends StatelessWidget {
  const _Pager({
    required this.page,
    required this.pages,
    required this.first,
    required this.last,
    required this.total,
    required this.onPage,
  });
  final int page;
  final int pages;
  final int first;
  final int last;
  final int total;
  final ValueChanged<int> onPage;

  @override
  Widget build(BuildContext context) {
    Widget arrow(String icon, String label, bool enabled, int to) => Glass(
      radius: 14,
      height: 44,
      semanticLabel: label,
      onTap: enabled ? () => onPage(to) : null,
      child: SizedBox(
        width: 44,
        child: Center(child: AtriaIcon(icon, color: enabled ? AtriaColors.ink800 : AtriaColors.ink400)),
      ),
    );
    return Row(
      children: [
        Expanded(
          child: Text('$first to $last of $total', style: AtriaType.body(size: 12.5, color: AtriaColors.inkMuted)),
        ),
        arrow('chevronLeft', 'Previous page', page > 0, page - 1),
        const SizedBox(width: 8),
        arrow('chevronRight', 'Next page', page < pages - 1, page + 1),
      ],
    );
  }
}

/// One visit on the list (36:5): the date tile, who and where, the time and
/// its state, and what can be done about it.
class VisitCard extends StatelessWidget {
  const VisitCard({super.key, required this.appointment, required this.data, required this.store});
  final Appointment appointment;
  final PatientData data;
  final PatientStore store;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final clinician = data.clinicianOf(a);
    final clinic = data.clinicOf(a);
    final type = data.typeOf(a);
    final (label, tone) = stateLabel(a.state);
    final active = activeStates.contains(a.state) && isAhead(a, DateTime.now());
    final title = clinician?.name ?? type?.name ?? 'Your visit';
    // A queue place is titled by its consultation, so the line under it names only the unit.
    final sub = a.sessionId != null
        ? clinic?.name ?? ''
        : [clinician?.specialty ?? type?.name, clinic?.name].whereType<String>().toSet().join(' · ');
    final request = a.state == 'REQUESTED';

    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DateTile(instant: a.startAt, muted: !active, blank: request),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      overflow: TextOverflow.ellipsis,
                      style: AtriaType.display(
                        size: 17,
                        weight: FontWeight.w600,
                      ).copyWith(letterSpacing: 0, height: 1.3),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      sub,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AtriaType.body(size: 13, color: AtriaColors.inkSoft, height: 1.3),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (!request)
                          Pill(
                            icon: 'clock',
                            text: a.sessionId != null
                                ? 'Arrive ${ClinicClock.time(a.startAt)}'
                                : '${ClinicClock.time(a.startAt)} to ${ClinicClock.time(a.endAt)}',
                            colour: AtriaColors.bookedInk,
                          ),
                        Pill(text: label, colour: toneColour(tone)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              if (active) ...[
                Expanded(
                  child: OutlineDanger(
                    label: a.sessionId != null ? 'Give up place' : 'Cancel visit',
                    onTap: () => cancelVisit(context, a, data, store),
                  ),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: SmallPrimary(label: 'Details', onTap: () => context.go('/visits/${a.id}')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The date on the brand gradient (36:6): month over day.
class DateTile extends StatelessWidget {
  const DateTile({super.key, required this.instant, this.muted = false, this.blank = false});
  final DateTime instant;
  final bool muted;
  final bool blank;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 58,
      height: 58,
      decoration: BoxDecoration(
        gradient: muted
            ? cssGradient(145, const [Color(0xFF9DB0D3), Color(0xFF7D93BD)])
            : cssGradient(145, const [AtriaColors.blue500, Color(0xFF2159D2)], [.141, .859]),
        borderRadius: BorderRadius.circular(17),
        boxShadow: muted ? null : const [BoxShadow(offset: Offset(0, 6), blurRadius: 14, color: Color(0x472159D2))],
      ),
      child: blank
          ? const Center(child: AtriaIcon('inbox', size: 22, color: Colors.white))
          : Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  ClinicClock.month(instant),
                  style: AtriaType.body(
                    size: 10.5,
                    weight: FontWeight.w700,
                    color: Colors.white,
                    height: 1.2,
                  ).copyWith(letterSpacing: .6),
                ),
                Text(
                  ClinicClock.date(instant),
                  style: AtriaType.display(
                    size: 23,
                    weight: FontWeight.w700,
                    color: Colors.white,
                  ).copyWith(height: 1.1),
                ),
              ],
            ),
    );
  }
}

/// A small tinted pill (36:14): status hue at low opacity with a hairline of it.
class Pill extends StatelessWidget {
  const Pill({super.key, required this.text, required this.colour, this.icon});
  final String text;
  final Color colour;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colour.withValues(alpha: .45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[AtriaIcon(icon!, size: 12, color: colour), const SizedBox(width: 5)],
          Text(
            text,
            style: AtriaType.body(size: 11.5, weight: FontWeight.w600, color: colour, height: 1.2),
          ),
        ],
      ),
    );
  }
}

class OutlineDanger extends StatelessWidget {
  const OutlineDanger({super.key, required this.label, required this.onTap, this.height = 46});
  final String label;
  final VoidCallback? onTap;
  final double height;

  @override
  Widget build(BuildContext context) {
    return PressableSurface(
      color: Colors.white,
      border: Border.all(color: AtriaColors.cancelled, width: 1.5),
      radius: 16,
      height: height,
      ink: AtriaColors.cancelled,
      onTap: onTap,
      child: Text(
        label,
        style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: AtriaColors.cancelledInk),
      ),
    );
  }
}

class SmallPrimary extends StatelessWidget {
  const SmallPrimary({super.key, required this.label, required this.onTap, this.height = 46, this.busy = false});
  final String label;
  final VoidCallback? onTap;
  final double height;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: PressableSurface(
        gradient: onTap == null ? AtriaGradients.disabled : accentGradient(160),
        shadow: onTap == null ? null : const BoxShadow(offset: Offset(0, 6), blurRadius: 16, color: Color(0x4D2F6BE4)),
        radius: 16,
        height: height,
        ink: Colors.white,
        onTap: busy ? null : onTap,
        child: busy
            ? LoadingIndicator(size: 22, color: Colors.white, label: label)
            : Text(
                label,
                style: AtriaType.body(size: 13.5, weight: FontWeight.w600, color: Colors.white),
              ),
      ),
    );
  }
}

/// "Mobile · Visit details" (Figma 36:115): when, who, where, the reminder
/// and what has happened, with cancel and move in a dock (FR-VIS-02).
class VisitDetailScreen extends StatelessWidget {
  const VisitDetailScreen({super.key, required this.id, required this.store, this.cancel = false});
  final String id;
  final PatientStore store;
  final bool cancel;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final state = store.state;
        if (state is! DataReady) return const Scaffold(body: Center(child: LoadingIndicator()));
        final data = state.data;
        final a = data.appointments.where((x) => x.id == id).firstOrNull;
        if (a == null) {
          return Scaffold(
            body: PageBackground(
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _TopBar(title: 'Visit details'),
                      const SizedBox(height: 20),
                      const Notice('That visit is not on your list.', tone: NoticeTone.error),
                    ],
                  ),
                ),
              ),
            ),
          );
        }
        return _Detail(appointment: a, data: data, store: store, openCancel: cancel);
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Glass(
          radius: 16,
          height: 46,
          semanticLabel: 'Back to your visits',
          onTap: () => context.canPop() ? context.pop() : context.go('/visits'),
          child: const SizedBox(
            width: 46,
            child: Center(child: AtriaIcon('chevronLeft', size: 19, color: AtriaColors.ink800)),
          ),
        ),
        Expanded(
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: AtriaType.display(size: 17, weight: FontWeight.w600).copyWith(letterSpacing: 0),
          ),
        ),
        const SizedBox(width: 46),
      ],
    );
  }
}

class _Detail extends StatefulWidget {
  const _Detail({required this.appointment, required this.data, required this.store, required this.openCancel});
  final Appointment appointment;
  final PatientData data;
  final PatientStore store;
  final bool openCancel;

  @override
  State<_Detail> createState() => _DetailState();
}

class _DetailState extends State<_Detail> {
  bool confirming = false;
  String? said;

  @override
  void initState() {
    super.initState();
    if (widget.openCancel) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) cancelVisit(context, widget.appointment, widget.data, widget.store);
      });
    }
  }

  Future<void> confirm() async {
    setState(() => confirming = true);
    try {
      await widget.store.api.send('POST', '/appointments/${widget.appointment.id}/confirm');
      await widget.store.reload();
    } on ApiError catch (e) {
      if (mounted) setState(() => said = e.message);
    } finally {
      if (mounted) setState(() => confirming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.appointment;
    final data = widget.data;
    final clinician = data.clinicianOf(a);
    final clinic = data.clinicOf(a);
    final type = data.typeOf(a);
    final (label, _) = stateLabel(a.state);
    final active = activeStates.contains(a.state) && isAhead(a, DateTime.now());
    final local = ClinicClock.local(a.startAt);
    final minutes = a.endAt.difference(a.startAt).inMinutes;
    final reminderAt = a.startAt.subtract(const Duration(hours: 24));
    final hasDock = active;

    return Scaffold(
      extendBody: true,
      body: PageBackground(
        child: SafeArea(
          bottom: false,
          child: ListView(
            padding: EdgeInsets.fromLTRB(20, 26, 20, hasDock ? 120 : 40),
            children: [
              const Rise(child: _TopBar(title: 'Visit details')),
              const SizedBox(height: 20),
              Rise(
                index: 1,
                child: _WhenCard(
                  tag: label,
                  title: a.state == 'REQUESTED'
                      ? 'Request sent'
                      : a.state == 'DECLINED'
                      ? 'Not scheduled'
                      : '${_longDays[local.weekday - 1].substring(0, 3)} ${local.day} ${_longMonths[local.month - 1]} ${local.year}',
                  sub: [
                    type?.name,
                    if (minutes > 0 && a.sessionId == null) '$minutes minutes',
                  ].whereType<String>().join(' · '),
                  cells: a.state == 'REQUESTED'
                      ? [('STATUS', 'Awaiting a time'), ('REF', a.reference)]
                      : a.state == 'DECLINED'
                      ? [('STATUS', 'Declined'), ('TIME', 'None'), ('REF', a.reference)]
                      : a.sessionId != null
                      ? [
                          ('ARRIVE', ClinicClock.time(a.startAt)),
                          ('PLACE', '${a.position ?? '-'}'),
                          ('REF', a.reference),
                        ]
                      : [
                          ('STARTS', ClinicClock.time(a.startAt)),
                          ('ENDS', ClinicClock.time(a.endAt)),
                          ('REF', a.reference),
                        ],
                ),
              ),
              if (said != null) ...[const SizedBox(height: 16), Notice(said!, tone: NoticeTone.error)],
              if (a.state == 'REQUESTED' || a.state == 'DECLINED') ...[
                const SizedBox(height: 16),
                Rise(
                  index: 2,
                  child: _RequestCard(appointment: a, unit: clinic?.name),
                ),
              ],
              if (a.state == 'DISRUPTED') ...[
                const SizedBox(height: 16),
                Rise(
                  index: 2,
                  child: NewTimeOffer(appointment: a, store: widget.store),
                ),
              ],
              const SizedBox(height: 16),
              Rise(
                index: 2,
                child: Glass(
                  radius: 26,
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Container(
                        width: 54,
                        height: 54,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: cssGradient(145, const [Color(0xFF5B8DF2), Color(0xFF2A62DC)], [.141, .859]),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: clinician == null
                            ? const AtriaIcon('stethoscope', size: 22, color: Colors.white)
                            : Text(
                                initials(clinician.givenName, clinician.familyName),
                                style: AtriaType.display(size: 16, weight: FontWeight.w600, color: Colors.white),
                              ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              clinician?.name ??
                                  (a.sessionId != null ? 'The doctor on duty' : 'A clinician is assigned when placed'),
                              style: AtriaType.display(size: 16, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              [clinician?.specialty, clinic?.name].whereType<String>().join(' · '),
                              style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft, height: 1.3),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Rise(index: 3, child: _WhereCard(clinic: clinic)),
              if (active && a.sessionId == null) ...[
                const SizedBox(height: 16),
                Rise(
                  index: 4,
                  child: Glass(
                    radius: 26,
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AtriaColors.awaiting.withValues(alpha: .14),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const AtriaIcon('bell', size: 19, color: AtriaColors.awaitingInk),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Reminder',
                                style: AtriaType.display(size: 15, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                              ),
                              Text(
                                reminderAt.isAfter(DateTime.now())
                                    ? 'A text goes out ${ClinicClock.day(reminderAt)} at ${ClinicClock.time(reminderAt)}, a day before.'
                                    : 'Too close for a reminder: your confirmation came by text instead.',
                                style: AtriaType.body(size: 12.5, color: AtriaColors.inkMuted, height: 1.4),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              if (type?.intakeForm != null) ...[
                const SizedBox(height: 16),
                Rise(
                  index: 4,
                  child: BeforeVisitCard(
                    api: widget.store.api,
                    appointmentId: a.id,
                    clinician: clinician?.name ?? 'your clinician',
                  ),
                ),
              ],
              if (active) ...[
                const SizedBox(height: 16),
                SecondaryButton(
                  label: 'Add to calendar',
                  leading: const AtriaIcon('calendar', size: 18, color: AtriaColors.blue600),
                  onPressed: () => addToCalendar(context, a, data),
                ),
              ],
              if (active && a.state == 'BOOKED') ...[
                const SizedBox(height: 12),
                SmallPrimary(label: "I'll be there", busy: confirming, onTap: confirm, height: 50),
              ],
              const SizedBox(height: 16),
              Rise(index: 5, child: _History(appointment: a)),
            ],
          ),
        ),
      ),
      bottomNavigationBar: hasDock
          ? SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: cssGradient(170, [
                    Colors.white.withValues(alpha: .94),
                    Colors.white.withValues(alpha: .78),
                  ]),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: Colors.white),
                  boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 30, color: Color(0x290F295E))],
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlineDanger(
                        label: a.sessionId != null ? 'Give up place' : 'Cancel',
                        height: 50,
                        onTap: () => cancelVisit(context, a, data, widget.store),
                      ),
                    ),
                    if (a.sessionId == null && a.state != 'DISRUPTED') ...[
                      const SizedBox(width: 12),
                      Expanded(
                        child: SmallPrimary(
                          label: 'Reschedule',
                          height: 50,
                          onTap: () => showModalBottomSheet<void>(
                            useRootNavigator: true,
                            context: context,
                            isScrollControlled: true,
                            showDragHandle: true,
                            backgroundColor: AtriaColors.surfacePanel,
                            builder: (_) => SafeArea(
                              child: Padding(
                                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                                child: NewTimeOffer(appointment: a, store: widget.store, move: true),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            )
          : null,
    );
  }
}

/// The blue card at the top of the visit (36:116).
class _WhenCard extends StatelessWidget {
  const _WhenCard({required this.tag, required this.title, required this.sub, required this.cells});
  final String tag;
  final String title;
  final String sub;
  final List<(String, String)> cells;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: cssGradient(
          151,
          const [AtriaColors.blue500, AtriaColors.blue600, Color(0xFF1E52C4)],
          [.144, .472, .856],
        ),
        borderRadius: BorderRadius.circular(30),
        boxShadow: const [BoxShadow(offset: Offset(0, 12), blurRadius: 30, color: Color(0x571E52C4))],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -40,
            top: -60,
            child: Container(
              width: 200,
              height: 200,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Colors.white.withValues(alpha: .2), Colors.white.withValues(alpha: .04)],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .16),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: Colors.white.withValues(alpha: .7)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const AtriaIcon('checkMark', size: 12, color: Colors.white),
                      const SizedBox(width: 6),
                      Text(
                        tag.toUpperCase(),
                        style: AtriaType.body(
                          size: 11,
                          weight: FontWeight.w700,
                          color: Colors.white,
                          height: 1.3,
                        ).copyWith(letterSpacing: .6),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Text(title, style: AtriaType.display(size: 25, color: Colors.white).copyWith(height: 1.15)),
                if (sub.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(sub, style: AtriaType.body(size: 13, color: Colors.white.withValues(alpha: .88), height: 1.3)),
                ],
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  decoration: glassOnAccent(20),
                  child: Row(
                    children: [
                      for (final (k, v) in cells)
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                k,
                                style: AtriaType.body(
                                  size: 10.5,
                                  weight: FontWeight.w700,
                                  color: Colors.white.withValues(alpha: .85),
                                  height: 1.3,
                                ).copyWith(letterSpacing: .6),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                v,
                                overflow: TextOverflow.ellipsis,
                                style: AtriaType.display(
                                  size: 15,
                                  weight: FontWeight.w600,
                                  color: Colors.white,
                                ).copyWith(letterSpacing: 0),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Where (36:130): a drawn map, the unit and directions. The map is a
/// drawing, as on the web; directions open the maps app.
class _WhereCard extends StatelessWidget {
  const _WhereCard({required this.clinic});
  final Clinic? clinic;

  @override
  Widget build(BuildContext context) {
    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: SizedBox(height: 108, child: CustomPaint(painter: _MapPainter())),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      clinic?.name ?? 'The unit',
                      style: AtriaType.body(
                        size: 14,
                        weight: FontWeight.w700,
                        color: AtriaColors.inkPrimary,
                        height: 1.3,
                      ),
                    ),
                    if (clinic?.address != null)
                      Text(
                        clinic!.address!,
                        style: AtriaType.body(size: 12.5, color: AtriaColors.inkSoft, height: 1.3),
                      ),
                  ],
                ),
              ),
              PressableSurface(
                color: Colors.white,
                border: Border.all(color: AtriaColors.lineHairline, width: 1.5),
                radius: 15,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                ink: AtriaColors.blue700,
                onTap: () => openDirections(clinic),
                child: Text(
                  'Directions',
                  style: AtriaType.body(size: 13, weight: FontWeight.w600, color: AtriaColors.ink900),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MapPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFFE6EDFA));
    final road = Paint()
      ..color = const Color(0xFFD0DCF1)
      ..strokeWidth = 10;
    canvas.drawLine(Offset(size.width * .18, 0), Offset(size.width * .18, size.height), road);
    canvas.drawLine(Offset(size.width * .7, 0), Offset(size.width * .7, size.height), road);
    canvas.drawLine(Offset(0, size.height * .62), Offset(size.width * .38, size.height * .62), road);
    final route = Paint()
      ..color = const Color(0xFFC3D2EE)
      ..strokeWidth = 12
      ..style = PaintingStyle.stroke
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(
      Path()
        ..moveTo(0, size.height * .66)
        ..lineTo(size.width * .38, size.height * .66)
        ..lineTo(size.width * .48, size.height * .4)
        ..lineTo(size.width, size.height * .4),
      route,
    );
    final pin = Offset(size.width * .5, size.height * .44);
    canvas.drawCircle(pin, 13, Paint()..color = AtriaColors.blue600);
    canvas.drawCircle(pin, 6.5, Paint()..color = Colors.white);
    canvas.drawCircle(pin, 4, Paint()..color = AtriaColors.blue600);
  }

  @override
  bool shouldRepaint(_MapPainter old) => false;
}

class _History extends StatelessWidget {
  const _History({required this.appointment});
  final Appointment appointment;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final (label, tone) = stateLabel(a.state);
    final entries = [
      ('Booked', '${ClinicClock.day(a.createdAt)}, ${ClinicClock.time(a.createdAt)}', AtriaColors.blue600),
      if (!activeStates.contains(a.state) && a.state != 'REQUESTED')
        (label, ClinicClock.day(a.startAt), toneColour(tone)),
    ];
    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('History', style: AtriaType.display(size: 15, weight: FontWeight.w600).copyWith(letterSpacing: 0)),
          const SizedBox(height: 12),
          for (final (what, at, colour) in entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: colour, width: 3),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          what,
                          style: AtriaType.body(
                            size: 13.5,
                            weight: FontWeight.w700,
                            color: AtriaColors.ink900,
                            height: 1.3,
                          ),
                        ),
                        Text(at, style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The next free times with the same clinician, to take one: a disrupted
/// visit's new time (FR-VIS-06) or a move the patient asks for.
class NewTimeOffer extends StatefulWidget {
  const NewTimeOffer({super.key, required this.appointment, required this.store, this.move = false});
  final Appointment appointment;
  final PatientStore store;
  final bool move;

  @override
  State<NewTimeOffer> createState() => _NewTimeOfferState();
}

class _NewTimeOfferState extends State<NewTimeOffer> {
  List<DateTime>? offers;
  DateTime? busy;
  String? failed;

  @override
  void initState() {
    super.initState();
    final a = widget.appointment;
    final from = ClinicClock.isoDate(DateTime.now());
    final to = ClinicClock.isoDate(DateTime.now().add(const Duration(days: 6)));
    widget.store.api
        .get(
          '/clinicians/${Uri.encodeComponent(a.clinicianId ?? '')}/slots?from=$from&to=$to&typeId=${Uri.encodeComponent(a.typeId)}',
        )
        .then((found) {
          final days = (found['days'] as Map? ?? const {});
          final keys = days.keys.map((k) => '$k').toList()..sort();
          final all = [
            for (final k in keys)
              for (final s in (days[k] as List? ?? const [])) DateTime.parse((s as Map)['startAt'] as String),
          ].where((t) => t != a.startAt).take(6).toList();
          if (mounted) setState(() => offers = all);
        })
        .catchError((Object _) {
          if (mounted) setState(() => offers = []);
        });
  }

  Future<void> take(DateTime slot) async {
    setState(() {
      busy = slot;
      failed = null;
    });
    try {
      await widget.store.api.send('POST', '/appointments/${widget.appointment.id}/reschedule', {
        'startAt': slot.toUtc().toIso8601String().replaceFirst('.000', ''),
      });
      await widget.store.reload();
      if (mounted && widget.move) Navigator.of(context).pop();
    } on ApiError {
      if (mounted) {
        setState(() {
          failed = 'That time was just taken. Choose another.';
          busy = null;
          offers = offers?.where((o) => o != slot).toList();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.appointment;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.move)
          Text('Move this visit', style: AtriaType.display(size: 20))
        else
          Notice(
            'Your clinician can no longer see you at ${ClinicClock.time(a.startAt)}. Choose a new time below; '
            "please don't come in at the old one.",
            tone: NoticeTone.error,
          ),
        const SizedBox(height: 12),
        if (widget.move)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'The next free times with the same clinician. Your reminder moves with it.',
              style: AtriaType.body(color: AtriaColors.inkMuted),
            ),
          ),
        if (offers == null)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: LoadingIndicator(label: "Finding times"),
            ),
          )
        else if (offers!.isEmpty)
          Text('No free times this week with the same clinician.', style: AtriaType.body(color: AtriaColors.inkMuted))
        else
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final slot in offers!)
                SizedBox(
                  width: 150,
                  child: Glass(
                    radius: 16,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    semanticLabel: 'Move to ${ClinicClock.day(slot)} at ${ClinicClock.time(slot)}',
                    onTap: busy == null ? () => take(slot) : null,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ClinicClock.day(slot),
                          style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                        ),
                        Text(
                          busy == slot ? 'Moving' : ClinicClock.time(slot),
                          style: AtriaType.display(size: 18, weight: FontWeight.w600).copyWith(letterSpacing: 0),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        if (failed != null) ...[const SizedBox(height: 12), Notice(failed!, tone: NoticeTone.error)],
      ],
    );
  }
}

const _reasons = ['Feeling better', 'Schedule clash', 'Cost', 'Booked elsewhere', 'Other'];

/// "Mobile · Cancel visit" (Figma 37:2), as a sheet over the visit: the
/// reason, whether it falls inside the cancellation window, and what cancelling
/// records against the fee (FR-VIS-03, FR-MSR-06).
Future<void> cancelVisit(BuildContext context, Appointment a, PatientData data, PatientStore store) async {
  final said = await showModalBottomSheet<String>(
    useRootNavigator: true,
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: const Color(0xFFF7FAFF),
    barrierColor: const Color(0x590B1D45),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(34))),
    builder: (_) => _CancelSheet(appointment: a, data: data, store: store),
  );
  if (said != null && context.mounted) {
    say(context, said);
    if (GoRouterState.of(context).matchedLocation != '/visits') context.go('/visits');
  }
}

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({required this.appointment, required this.data, required this.store});
  final Appointment appointment;
  final PatientData data;
  final PatientStore store;

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  String? reason;

  /// "Other" asks in words, as every cancellation form on the web does.
  final other = TextEditingController();

  @override
  void dispose() {
    other.dispose();
    super.dispose();
  }

  bool busy = false;
  String? failure;
  Map<String, dynamic>? preview;

  @override
  void initState() {
    super.initState();
    widget.store.api
        .get('/appointments/${widget.appointment.id}')
        .then((found) {
          if (mounted) setState(() => preview = found['cancellationPreview'] as Map<String, dynamic>?);
        })
        .catchError((Object _) {});
  }

  Future<void> cancel() async {
    setState(() {
      busy = true;
      failure = null;
    });
    final a = widget.appointment;
    try {
      final said = reason == 'Other' && other.text.trim().isNotEmpty ? 'Other: ${other.text.trim()}' : reason;
      final result = await widget.store.api.send('DELETE', '/appointments/${a.id}', {'reason': ?said});
      await widget.store.reload();
      if (!mounted) return;
      Navigator.of(context).pop(
        result['outcome'] == 'CANCELLED_LATE'
            ? 'Visit ${a.reference} cancelled. It was inside the cancellation window, so it is recorded as late.'
            : 'Visit ${a.reference} cancelled. The time is free for someone else, and your reminder is removed.',
      );
    } on ApiError catch (e) {
      setState(() {
        failure = e.message;
        busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.appointment;
    final clinician = widget.data.clinicianOf(a);
    final clinic = widget.data.clinicOf(a);
    final away = a.startAt.difference(DateTime.now());
    final late = preview != null ? preview!['entitlement'] != 'FULL' : away.inHours < 24;
    final awayText = away.inHours >= 48 ? '${(away.inHours / 24).round()} days' : '${away.inHours.clamp(1, 999)} hours';
    final entitlement = (preview?['entitlement'] as String?) ?? (late ? 'PARTIAL' : 'FULL');
    final amount = preview?['amountMinor'] as int?;
    final noteColour = late ? AtriaColors.cancelled : AtriaColors.awaiting;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(22, 4, 22, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: cssGradient(145, const [Color(0xFFE8606F), Color(0xFFC33C4E)]),
                borderRadius: BorderRadius.circular(19),
                boxShadow: const [BoxShadow(offset: Offset(0, 10), blurRadius: 22, color: Color(0x4DC8384A))],
              ),
              child: const AtriaIcon('close', size: 22, color: Colors.white, stroke: 2.4),
            ),
            const SizedBox(height: 16),
            Text(
              a.sessionId != null ? 'Give up your place?' : 'Cancel this visit?',
              style: AtriaType.display(size: 23),
            ),
            const SizedBox(height: 8),
            Text(
              'The slot goes back to the clinic straight away, and your reminder is deleted.',
              style: AtriaType.body(size: 14, color: const Color(0xFF54658A)),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF2F6FE),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AtriaColors.lineHairline, width: 1.5),
              ),
              child: Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(gradient: accentGradient(), borderRadius: BorderRadius.circular(14)),
                    // A queue place has no clinician until the patient is called.
                    child: clinician == null
                        ? const AtriaIcon('stethoscope', size: 19, color: Colors.white)
                        : Text(
                            initials(clinician.givenName, clinician.familyName),
                            style: AtriaType.display(size: 14, weight: FontWeight.w600, color: Colors.white),
                          ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${clinician?.name ?? (a.sessionId != null ? 'General consultation' : 'Your visit')} · ${ClinicClock.time(a.startAt)}',
                          style: AtriaType.body(
                            size: 14,
                            weight: FontWeight.w700,
                            color: AtriaColors.inkPrimary,
                            height: 1.3,
                          ),
                        ),
                        Text(
                          [ClinicClock.day(a.startAt), clinic?.name].whereType<String>().join(' · '),
                          style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'REASON (OPTIONAL)',
              style: AtriaType.body(
                size: 11.5,
                weight: FontWeight.w700,
                color: AtriaColors.inkMuted,
              ).copyWith(letterSpacing: .8),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final r in _reasons)
                  Semantics(
                    button: true,
                    selected: reason == r,
                    child: Pressable(
                      onTap: () => setState(() => reason = reason == r ? null : r),
                      radius: 16,
                      ink: AtriaColors.blue700,
                      builder: (context, _) => AnimatedContainer(
                        duration: AtriaMotion.spatialFastDuration,
                        curve: AtriaMotion.spatialFast,
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                        decoration: BoxDecoration(
                          color: reason == r ? AtriaColors.blue600 : Colors.white,
                          borderRadius: BorderRadius.circular(reason == r ? 18 : 14),
                          border: Border.all(
                            color: reason == r ? AtriaColors.blue600 : AtriaColors.lineHairline,
                            width: 1.5,
                          ),
                        ),
                        child: Text(
                          r,
                          style: AtriaType.body(
                            size: 13,
                            weight: FontWeight.w600,
                            color: reason == r ? Colors.white : AtriaColors.ink800,
                            height: 1.2,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            // Choosing Other opens a line to say why (2026-09-28).
            AnimatedSize(
              duration: AtriaMotion.spatialDefaultDuration,
              curve: AtriaMotion.spatialDefault,
              child: reason == 'Other'
                  ? Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: TextField(
                        onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                        controller: other,
                        autofocus: true,
                        minLines: 2,
                        maxLines: 3,
                        maxLength: 200,
                        textCapitalization: TextCapitalization.sentences,
                        style: AtriaType.body(size: 14, color: AtriaColors.inkPrimary),
                        decoration: InputDecoration(
                          hintText: 'Tell the clinic why, in a few words',
                          hintStyle: AtriaType.body(size: 14, color: const Color(0xFF9AA9C4)),
                          filled: true,
                          fillColor: Colors.white,
                          counterText: '',
                          contentPadding: const EdgeInsets.all(14),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(16),
                            borderSide: const BorderSide(color: AtriaColors.lineHairline, width: 1.5),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(16),
                            borderSide: const BorderSide(color: AtriaColors.blue500, width: 1.5),
                          ),
                        ),
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: noteColour.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: noteColour.withValues(alpha: .6)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AtriaIcon('alert', size: 15, color: late ? AtriaColors.cancelledInk : AtriaColors.awaitingInk),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      late
                          ? 'This visit is $awayText away, inside the 24 hour cancellation window, so it will be recorded as a late cancellation.'
                          : 'Cancelling inside 24 hours of a visit is recorded by the clinic. This one is $awayText away, so nothing is flagged.',
                      style: AtriaType.body(
                        size: 12.5,
                        color: late ? AtriaColors.cancelledInk : AtriaColors.awaitingInk,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Entitlement recorded: ${{'FULL': 'full', 'PARTIAL': 'partial', 'NONE': 'none'}[entitlement]}'
              '${amount != null ? ' of $amount XAF' : ''}. Nothing is charged or paid through Atria.',
              style: AtriaType.body(size: 12, color: AtriaColors.inkMuted, height: 1.4),
            ),
            if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: SecondaryButton(label: 'Keep it', onPressed: busy ? null : () => Navigator.of(context).pop()),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: PressableSurface(
                    gradient: cssGradient(160, const [Color(0xFFE8606F), Color(0xFFC33C4E)]),
                    shadow: const BoxShadow(offset: Offset(0, 10), blurRadius: 22, color: Color(0x4DC8384A)),
                    radius: 19,
                    height: 56,
                    ink: Colors.white,
                    semanticLabel: 'Cancel visit',
                    onTap: busy ? null : cancel,
                    child: busy
                        ? const LoadingIndicator(size: 22, color: Colors.white, label: 'Cancelling')
                        : Text(
                            'Cancel visit',
                            style: AtriaType.body(size: 14.5, weight: FontWeight.w600, color: Colors.white),
                          ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A procedure request (FR-BKG-12): what the patient wrote, and either that
/// the unit is sizing it or why it could not be scheduled, with a way to talk
/// it through at a consultation instead.
class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.appointment, this.unit});
  final Appointment appointment;
  final String? unit;

  @override
  Widget build(BuildContext context) {
    final declined = appointment.state == 'DECLINED';
    final tone = declined ? AtriaColors.cancelledInk : AtriaColors.awaitingInk;
    return Glass(
      radius: 26,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your request', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: tone.withValues(alpha: .08), borderRadius: BorderRadius.circular(16)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AtriaIcon(declined ? 'alert' : 'clock', size: 16, color: tone),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    declined
                        ? '${appointment.declineReason ?? 'The unit could not schedule this.'} '
                              'You can book a consultation to talk it through.'
                        : 'No time is held yet. The unit sizes the procedure and places it with a clinician; '
                              'you then confirm the time.',
                    style: AtriaType.body(size: 13, color: AtriaColors.ink800, height: 1.4),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'UNIT',
            style: AtriaType.body(size: 10.5, weight: FontWeight.w700, color: AtriaColors.inkMuted),
          ),
          const SizedBox(height: 2),
          Text(unit ?? 'Not listed', style: AtriaType.body(size: 14, weight: FontWeight.w600)),
          const SizedBox(height: 10),
          Text(
            'WHAT YOU WROTE',
            style: AtriaType.body(size: 10.5, weight: FontWeight.w700, color: AtriaColors.inkMuted),
          ),
          const SizedBox(height: 2),
          Text(
            (appointment.requestNote ?? '').trim().isEmpty ? 'Nothing added' : appointment.requestNote!,
            style: AtriaType.body(size: 14, color: AtriaColors.ink800),
          ),
          if (declined) ...[
            const SizedBox(height: 16),
            PrimaryButton(label: 'Book a consultation', onPressed: () => context.push('/queue')),
          ],
        ],
      ),
    );
  }
}
