import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../api/api.dart';
import '../auth/forms.dart';
import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/filters.dart';
import '../ui/form_parts.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import '../ui/layout.dart';
import '../ui/loading.dart';
import '../ui/search.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'parts.dart';

/// A patient in the register.
class RegisterEntry {
  RegisterEntry(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['patientProfileId'] as String;
  String? get given => raw['givenName'] as String?;
  String? get family => raw['familyName'] as String?;
  String get name => [given, family].whereType<String>().join(' ').trim().isEmpty
      ? 'Patient'
      : [given, family].whereType<String>().join(' ');
  String? get phone => raw['phoneE164'] as String?;
  String? get number => raw['patientNumber'] as String?;
  String? get born => raw['dateOfBirth'] as String?;
}

/// "34 years", from a date of birth.
String? age(String? born) {
  if (born == null) return null;
  final d = DateTime.tryParse(born);
  if (d == null) return null;
  final now = DateTime.now();
  var years = now.year - d.year;
  if (now.month < d.month || (now.month == d.month && now.day < d.day)) years--;
  return years < 1 ? 'Under 1 year' : '$years years';
}

/// The register (web: Patients.tsx, FR-STF-06): one search by name, mobile
/// or patient number, answered as the desk types; a new patient is added
/// with a minimal record and booked straight away.
class PatientsScreen extends StatefulWidget {
  const PatientsScreen({super.key, required this.store});
  final StaffStore store;

  @override
  State<PatientsScreen> createState() => _PatientsScreenState();
}

class _PatientsScreenState extends State<PatientsScreen> {
  final query = TextEditingController();
  List<RegisterEntry>? results;
  String? failure;
  int page = 0;
  Timer? wait;
  int asked = 0;

  @override
  void initState() {
    super.initState();
    find('');
  }

  @override
  void dispose() {
    wait?.cancel();
    query.dispose();
    super.dispose();
  }

  Future<void> find(String words) async {
    final n = ++asked;
    try {
      final w = words.trim();
      final found = w.isEmpty
          ? await all(widget.store.api, '/patients', 'results')
          : ((await widget.store.api.get('/patients?q=${Uri.encodeQueryComponent(w)}'))['results'] as List? ?? const [])
                .cast<Map<String, dynamic>>();
      if (mounted && n == asked) {
        setState(() {
          results = found.map(RegisterEntry.new).toList();
          failure = null;
          page = 0;
        });
      }
    } on ApiError catch (e) {
      if (mounted && n == asked) setState(() => failure = e.message);
    }
  }

  Future<void> register() async {
    final made = await newPatient(context, widget.store.api, start: query.text);
    if (made == null || !mounted) return;
    context.push(made.$2 ? '/console/book?patient=${made.$1.id}' : '/console/patients/${made.$1.id}');
  }

  @override
  Widget build(BuildContext context) {
    final list = results;
    final pages = Pages(list ?? const <RegisterEntry>[], phonePage, page);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 130),
      children: [
        Rise(
          child: StaffHeader(
            title: 'Patients',
            sub: 'Search by name, mobile or patient number',
            trailing: SmallAdd(label: 'New patient', onTap: register),
          ),
        ),
        const SizedBox(height: 16),
        Rise(
          index: 1,
          child: SearchSuggest(
            controller: query,
            groups: const [],
            placeholder: 'Name, mobile or RHB number',
            onChanged: (v) {
              wait?.cancel();
              wait = Timer(const Duration(milliseconds: 300), () => find(v));
            },
          ),
        ),
        const SizedBox(height: 14),
        if (failure != null)
          Notice(failure!, tone: NoticeTone.error)
        else if (list == null)
          const Padding(
            padding: EdgeInsets.all(40),
            child: Center(child: LoadingIndicator(label: 'Searching')),
          )
        else if (list.isEmpty)
          Glass(
            radius: 22,
            padding: const EdgeInsets.all(18),
            child: Column(
              children: [
                Text(
                  query.text.trim().isEmpty ? 'No patients yet.' : 'No patient matches "${query.text.trim()}".',
                  textAlign: TextAlign.center,
                  style: AtriaType.body(color: AtriaColors.inkMuted),
                ),
                const SizedBox(height: 12),
                PrimaryButton(label: 'Add them as a new patient', onPressed: register),
              ],
            ),
          )
        else ...[
          for (final (i, p) in pages.shown.indexed) ...[
            if (i > 0) const SizedBox(height: 9),
            Rise(
              index: 2 + i,
              child: Glass(
                radius: 20,
                onTap: () => context.push('/console/patients/${p.id}'),
                semanticLabel: p.name,
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Initials(initials(p.given, p.family)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p.name,
                            style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                          ),
                          Text(
                            [p.number, p.phone, age(p.born)].whereType<String>().join(' · '),
                            style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                          ),
                        ],
                      ),
                    ),
                    const AtriaIcon('chevronRight', size: 16, color: AtriaColors.ink400),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Pager.of(
            pages,
            noun: 'patients',
            onPrevious: () => setState(() => page--),
            onNext: () => setState(() => page++),
          ),
        ],
      ],
    );
  }
}

/// A small blue "+ label" action in a header.
class SmallAdd extends StatelessWidget {
  const SmallAdd({super.key, required this.label, required this.onTap, this.icon = 'plus'});
  final String label;
  final VoidCallback onTap;
  final String icon;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    radius: 16,
    ink: Colors.white,
    semanticLabel: label,
    builder: (context, pressed) => AnimatedContainer(
      duration: AtriaMotion.spatialFastDuration,
      curve: AtriaMotion.spatialFast,
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        gradient: accentGradient(),
        borderRadius: BorderRadius.circular(pressed ? 11 : 16),
        boxShadow: const [BoxShadow(offset: Offset(0, 6), blurRadius: 14, color: Color(0x4D2F6BE4))],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AtriaIcon(icon, size: 16, color: Colors.white),
          const SizedBox(width: 6),
          Text(
            label,
            style: AtriaType.body(size: 13, weight: FontWeight.w700, color: Colors.white),
          ),
        ],
      ),
    ),
  );
}

/// Add a patient (web: NewPatient): given and family name, mobile, date of
/// birth if known, the language of their messages, and, when the number is
/// already on the register, a confirmation that this is someone else.
/// Returns the new entry and whether to book now.
Future<(RegisterEntry, bool)?> newPatient(BuildContext context, Api api, {String start = ''}) =>
    showModalBottomSheet<(RegisterEntry, bool)>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AtriaColors.surfacePanel,
      builder: (_) => _NewPatient(api: api, start: start),
    );

class _NewPatient extends StatefulWidget {
  const _NewPatient({required this.api, required this.start});
  final Api api;
  final String start;

  @override
  State<_NewPatient> createState() => _NewPatientState();
}

class _NewPatientState extends State<_NewPatient> {
  late final given = TextEditingController(text: splitName(widget.start)?.$1 ?? widget.start.trim());
  late final family = TextEditingController(text: splitName(widget.start)?.$2 ?? '');
  final phone = TextEditingController();
  final born = TextEditingController();
  String language = 'en';
  List<RegisterEntry>? shared;
  bool sameNumber = false;
  bool busy = false;
  String? failure;

  @override
  void initState() {
    super.initState();
    for (final c in [given, family, born]) {
      c.addListener(() => setState(() {}));
    }
    phone.addListener(
      () => setState(() {
        shared = null;
        sameNumber = false;
      }),
    );
  }

  @override
  void dispose() {
    for (final c in [given, family, phone, born]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> save(bool book) async {
    setState(() {
      busy = true;
      failure = null;
    });
    try {
      final made = await widget.api.send('POST', '/patients', {
        'givenName': given.text.trim(),
        'familyName': family.text.trim(),
        'phoneE164': normalisePhone(phone.text),
        if (birthDate(born.text) != null) 'dateOfBirth': birthDate(born.text),
        'preferredLanguage': language,
        if (sameNumber) 'sameNumberConfirmed': true,
      });
      if (mounted) Navigator.pop(context, (RegisterEntry(made), book));
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.status == 409) {
          shared = (e.detail?['patients'] as List? ?? const [])
              .cast<Map<String, dynamic>>()
              .map(RegisterEntry.new)
              .toList();
        } else {
          failure = '${sentence(e.message)} Nothing was saved.';
        }
        busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bornWrong = born.text.trim().isNotEmpty && birthDate(born.text) == null;
    final ready =
        given.text.trim().isNotEmpty &&
        family.text.trim().isNotEmpty &&
        isMobile(normalisePhone(phone.text)) &&
        !bornWrong &&
        (shared == null || sameNumber);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .88),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
            children: [
              Text('New patient', style: AtriaType.display(size: 22)),
              const SizedBox(height: 6),
              Text(
                'A minimal record, with a patient number, so they can be booked now. They can create an account later with the same mobile number.',
                style: AtriaType.body(size: 13, color: AtriaColors.inkMuted),
              ),
              const SizedBox(height: 16),
              AtriaField(
                label: 'Given name',
                icon: 'user',
                controller: given,
                capitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 12),
              AtriaField(
                label: 'Family name',
                icon: 'user',
                controller: family,
                capitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 12),
              AtriaField(
                label: 'Mobile number',
                icon: 'phone',
                controller: phone,
                hint: '6 70 00 00 00',
                keyboard: TextInputType.phone,
                prefixText: '$homeDialCode ',
                formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ]'))],
                help: 'Reminders go here by SMS.',
              ),
              const SizedBox(height: 12),
              AtriaField(
                label: 'Date of birth, if known',
                icon: 'pencil',
                controller: born,
                hint: 'DD/MM/YYYY',
                keyboard: TextInputType.number,
                formatters: [DateMask()],
                error: bornWrong ? 'Enter a real date, such as 02/04/1990, or leave it empty.' : null,
              ),
              const SizedBox(height: 14),
              Text(
                'Messages in',
                style: AtriaType.body(size: 12, weight: FontWeight.w600, color: AtriaColors.inkSoft),
              ),
              const SizedBox(height: 7),
              Segmented(
                labels: const ['English', 'French'],
                selected: language == 'fr' ? 1 : 0,
                onChanged: (i) => setState(() => language = i == 1 ? 'fr' : 'en'),
              ),
              if (shared != null) ...[
                const SizedBox(height: 14),
                Notice(
                  '${shared!.length == 1 ? 'A patient already has' : '${shared!.length} patients already have'} this number. Families often share a phone; if this is one of them, open their record instead.',
                ),
                for (final p in shared!)
                  TextButton(
                    onPressed: () {
                      Navigator.pop(context);
                      context.push('/console/patients/${p.id}');
                    },
                    child: Text('${p.name} · ${p.number ?? ''}'),
                  ),
                AtriaCheckbox(
                  checked: sameNumber,
                  onChanged: (v) => setState(() => sameNumber = v),
                  label: 'This is someone else sharing the number',
                ),
              ],
              if (failure != null) ...[const SizedBox(height: 12), Notice(failure!, tone: NoticeTone.error)],
              const SizedBox(height: 18),
              PrimaryButton(label: 'Save and book', busy: busy, onPressed: ready && !busy ? () => save(true) : null),
              const SizedBox(height: 10),
              SecondaryButton(label: 'Save only', onPressed: ready && !busy ? () => save(false) : null),
            ],
          ),
        ),
      ),
    );
  }
}

/// A patient's record (web: PatientRecordPage, FR-STF-07): contact, what
/// has been proven, and the visits the viewer's role may see. Care context
/// is never here.
class PatientRecordScreen extends StatefulWidget {
  const PatientRecordScreen({super.key, required this.store, required this.id});
  final StaffStore store;
  final String id;

  @override
  State<PatientRecordScreen> createState() => _PatientRecordScreenState();
}

class _PatientRecordScreenState extends State<PatientRecordScreen> {
  Map<String, dynamic>? record;
  String? failure;
  int page = 0;

  @override
  void initState() {
    super.initState();
    widget.store.api
        .get('/patients/${Uri.encodeComponent(widget.id)}')
        .then(
          (r) {
            if (mounted) setState(() => record = r);
          },
          onError: (Object e) {
            if (mounted) setState(() => failure = e is ApiError ? e.message : 'The record could not be read.');
          },
        );
  }

  @override
  Widget build(BuildContext context) {
    final r = record;
    final entry = r == null ? null : RegisterEntry(r);
    final visits = [
      for (final a in (r?['appointments'] as List? ?? const []).cast<Map<String, dynamic>>()) Appointment(a),
    ]..sort((a, b) => b.startAt.compareTo(a.startAt));
    final pages = Pages(visits, phonePage, page);
    final dir = widget.store.directory;
    Widget fact(String k, String v, [Widget? end]) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  k,
                  style: AtriaType.body(size: 11.5, weight: FontWeight.w700, color: AtriaColors.inkSoft),
                ),
                Text(v, style: AtriaType.body(size: 14, color: AtriaColors.ink900)),
              ],
            ),
          ),
          ?end,
        ],
      ),
    );
    return Scaffold(
      body: PageBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 40),
            children: [
              Rise(
                child: StaffHeader(
                  title: entry?.name ?? 'Patient',
                  sub: entry == null
                      ? 'Loading the record'
                      : [entry.number, age(entry.born)].whereType<String>().join(' · '),
                  back: '/console/patients',
                ),
              ),
              const SizedBox(height: 16),
              if (failure != null)
                Notice(failure!, tone: NoticeTone.error)
              else if (r == null)
                const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: LoadingIndicator(label: 'Loading')),
                )
              else ...[
                Rise(
                  index: 1,
                  child: PrimaryButton(
                    label: 'Book a visit',
                    onPressed: () => context.push('/console/book?patient=${widget.id}'),
                  ),
                ),
                const SizedBox(height: 16),
                Rise(
                  index: 2,
                  child: Glass(
                    radius: 26,
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Contact', style: AtriaType.display(size: 16, weight: FontWeight.w600)),
                        const SizedBox(height: 12),
                        fact(
                          'MOBILE',
                          entry?.phone ?? 'None',
                          StateChip(
                            r['phoneVerified'] == true ? 'Verified' : 'Not verified',
                            r['phoneVerified'] == true ? StaffTone.confirmed : StaffTone.neutral,
                          ),
                        ),
                        fact('EMAIL', r['email'] as String? ?? 'None'),
                        fact(
                          'DATE OF BIRTH',
                          entry?.born == null ? 'Not given' : ClinicClock.long(ClinicClock.onDate(entry!.born!)),
                        ),
                        fact(
                          'MESSAGES IN',
                          r['preferredLanguage'] == null
                              ? 'Not chosen'
                              : languageName(r['preferredLanguage'] as String),
                        ),
                        fact(
                          'ACCOUNT',
                          r['hasAccount'] == true ? 'Signs in to Atria' : 'No account yet',
                          StateChip(r['source'] == 'DESK' ? 'Registered at the desk' : 'Signed up', StaffTone.booked),
                        ),
                        Text(
                          'Care context, what a patient sends ahead of a visit, is never shown here. Opening this record is in the audit log.',
                          style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                SectionHead(
                  title: 'Visits',
                  link: switch (r['visitScope']) {
                    'own' => 'Yours',
                    'clinic' => 'In your unit',
                    _ => null,
                  },
                ),
                const SizedBox(height: 10),
                if (visits.isEmpty)
                  Text('No visits to show.', style: AtriaType.body(color: AtriaColors.inkMuted))
                else ...[
                  for (final (i, a) in pages.shown.indexed) ...[
                    if (i > 0) const SizedBox(height: 8),
                    Glass(
                      radius: 20,
                      onTap: () => context.push('/console/visits/${a.id}'),
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${ClinicClock.day(a.startAt)} · ${ClinicClock.time(a.startAt)}',
                                  style: AtriaType.body(size: 14, weight: FontWeight.w700, color: AtriaColors.ink900),
                                ),
                                Text(
                                  [
                                    dir?.type(a.typeId)?.name,
                                    dir?.clinician(a.clinicianId)?.name,
                                    a.reference,
                                  ].whereType<String>().join(' · '),
                                  style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                                ),
                              ],
                            ),
                          ),
                          StateChip.of(a.state),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Pager.of(pages, onPrevious: () => setState(() => page--), onNext: () => setState(() => page++)),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Book for a patient (web: BookForPatient.tsx, FR-BKG-07): the patient,
/// how they reached the desk (walk-in, phone, referral), the clinician and
/// the visit type, then a free time. Recorded against the staff account.
class BookForPatientScreen extends StatefulWidget {
  const BookForPatientScreen({super.key, required this.store, this.patientId, this.clinicianId});
  final StaffStore store;
  final String? patientId;
  final String? clinicianId;

  @override
  State<BookForPatientScreen> createState() => _BookForPatientScreenState();
}

class _BookForPatientScreenState extends State<BookForPatientScreen> {
  RegisterEntry? patient;
  String channel = 'WALK_IN';
  final callback = TextEditingController();
  final facility = TextEditingController();
  final referrer = TextEditingController();
  final note = TextEditingController();
  late String? clinicianId = widget.clinicianId;
  String? typeId;
  Map<String, List<DateTime>>? days;
  String? day;
  DateTime? slot;
  bool busy = false;
  String? failure;

  Api get api => widget.store.api;

  @override
  void initState() {
    super.initState();
    for (final c in [callback, facility, referrer, note]) {
      c.addListener(() => setState(() {}));
    }
    if (widget.patientId != null) {
      api.get('/patients/${Uri.encodeComponent(widget.patientId!)}').then((r) {
        if (!mounted) return;
        setState(() {
          patient = RegisterEntry(r);
          final phone = patient!.phone ?? '';
          callback.text = phone.startsWith(homeDialCode) ? phone.substring(homeDialCode.length) : phone;
        });
      }, onError: (Object _) {});
    }
  }

  @override
  void dispose() {
    for (final c in [callback, facility, referrer, note]) {
      c.dispose();
    }
    super.dispose();
  }

  List<Clinician> get clinicians {
    final dir = widget.store.directory;
    if (dir == null) return const [];
    final me = widget.store.me;
    return dir.clinicians.where((c) => c.clinicId == me.clinicId || c.id == me.staffId).toList();
  }

  List<AppointmentType> typesFor(Clinician? c) {
    final dir = widget.store.directory;
    if (dir == null || c == null) return const [];
    return dir.types
        .where(
          (t) =>
              t.durationUnits != null &&
              t.bookableBy != 'PATIENT' &&
              t.offeredAt(c.clinicId) &&
              (channel != 'REFERRAL' || t.serviceLine == 'SPECIALIST' || t.serviceLine == 'PROCEDURE'),
        )
        .toList();
  }

  Future<void> loadSlots(Clinician c, AppointmentType t) async {
    setState(() {
      days = null;
      day = null;
      slot = null;
    });
    final from = ClinicClock.isoDate(DateTime.now());
    final to = ClinicClock.isoDate(DateTime.now().add(const Duration(days: 13)));
    try {
      final found = await api.get(
        '/clinicians/${Uri.encodeComponent(c.id)}/slots?from=$from&to=$to&typeId=${Uri.encodeComponent(t.id)}',
      );
      final raw = (found['days'] as Map? ?? const {});
      final out = <String, List<DateTime>>{};
      for (final k in raw.keys.map((k) => '$k').toList()..sort()) {
        final times = [for (final s in (raw[k] as List? ?? const [])) DateTime.parse((s as Map)['startAt'] as String)]
            .where((x) => x.isAfter(DateTime.now()))
            .toList();
        if (times.isNotEmpty) out[k] = times;
      }
      if (mounted) {
        setState(() {
          days = out;
          day = out.keys.firstOrNull;
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => failure = e.message);
    }
  }

  Future<void> book(Clinician c, AppointmentType t) async {
    final p = patient;
    final s = slot;
    if (p == null || s == null) return;
    setState(() {
      busy = true;
      failure = null;
    });
    final start = s.toUtc().toIso8601String().replaceFirst('.000', '');
    try {
      final booked = await api.send(
        'POST',
        '/appointments',
        {
          'patientProfileId': p.id,
          'clinicianProfileId': c.id,
          'appointmentTypeId': t.id,
          'startAt': start,
          'channel': channel,
          if (channel == 'PHONE') 'callbackPhone': normalisePhone(callback.text),
          if (channel == 'REFERRAL') ...{
            'referringFacility': facility.text.trim(),
            'referringClinicianName': referrer.text.trim(),
            'referralNote': note.text.trim(),
          },
        },
        {'Idempotency-Key': 'desk-${p.id}-$start-${c.id}'},
      );
      if (!mounted) return;
      say(context, 'Booked ${booked['reference']} for ${p.name}.');
      context.pushReplacement('/console/visits/${booked['appointmentId']}');
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          failure = '${sentence(e.message)} Nothing was booked.';
          busy = false;
        });
        loadSlots(c, t);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = clinicians;
    final c = cs.where((x) => x.id == clinicianId).firstOrNull;
    final ts = typesFor(c);
    final t = ts.where((x) => x.id == typeId).firstOrNull ?? ts.firstOrNull;
    final channelReady =
        channel == 'WALK_IN' ||
        (channel == 'PHONE' && isMobile(normalisePhone(callback.text))) ||
        (channel == 'REFERRAL' && facility.text.trim().length > 1);
    final ready = patient != null && c != null && t != null && slot != null && channelReady;
    Widget label(String text) => Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 8),
      child: Text(text, style: AtriaType.display(size: 16, weight: FontWeight.w600)),
    );

    return Scaffold(
      body: PageBackground(
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
                  children: [
                    const Rise(
                      child: StaffHeader(
                        title: 'Book for a patient',
                        sub: 'Recorded against your account, with how the patient reached you.',
                        back: '/console/patients',
                      ),
                    ),
                    label('Patient'),
                    Glass(
                      radius: 22,
                      padding: const EdgeInsets.all(12),
                      child: patient == null
                          ? Row(
                              children: [
                                Expanded(
                                  child: Text('Nobody chosen yet', style: AtriaType.body(color: AtriaColors.inkMuted)),
                                ),
                                TextButton(
                                  onPressed: () async {
                                    final picked = await pickPatient(context, api);
                                    if (picked != null) setState(() => patient = picked);
                                  },
                                  child: const Text('Find a patient'),
                                ),
                              ],
                            )
                          : Row(
                              children: [
                                Initials(initials(patient!.given, patient!.family)),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        patient!.name,
                                        style: AtriaType.body(
                                          size: 14.5,
                                          weight: FontWeight.w700,
                                          color: AtriaColors.ink900,
                                        ),
                                      ),
                                      Text(
                                        [patient!.number, patient!.phone].whereType<String>().join(' · '),
                                        style: AtriaType.body(size: 12, color: AtriaColors.inkSoft),
                                      ),
                                    ],
                                  ),
                                ),
                                TextButton(
                                  onPressed: () async {
                                    final picked = await pickPatient(context, api);
                                    if (picked != null) setState(() => patient = picked);
                                  },
                                  child: const Text('Change'),
                                ),
                              ],
                            ),
                    ),
                    label('How they reached you'),
                    Segmented(
                      labels: const ['Walk-in', 'Phone', 'Referral'],
                      selected: ['WALK_IN', 'PHONE', 'REFERRAL'].indexOf(channel),
                      onChanged: (i) => setState(() {
                        channel = ['WALK_IN', 'PHONE', 'REFERRAL'][i];
                        typeId = null;
                      }),
                    ),
                    if (channel == 'PHONE') ...[
                      const SizedBox(height: 12),
                      AtriaField(
                        label: 'Number to call back',
                        icon: 'phone',
                        controller: callback,
                        keyboard: TextInputType.phone,
                        prefixText: '$homeDialCode ',
                        formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ]'))],
                      ),
                    ],
                    if (channel == 'REFERRAL') ...[
                      const SizedBox(height: 12),
                      AtriaField(label: 'Referring facility', icon: 'building', controller: facility),
                      const SizedBox(height: 10),
                      AtriaField(label: 'Referring clinician, if named', icon: 'user', controller: referrer),
                      const SizedBox(height: 10),
                      AtriaField(label: 'Referral note', icon: 'pencil', controller: note),
                    ],
                    label('Clinician'),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final x in cs)
                          FilterChipButton(
                            label: x.name,
                            on: x.id == clinicianId,
                            onTap: () {
                              setState(() {
                                clinicianId = x.id;
                                typeId = null;
                              });
                              final first = typesFor(x).firstOrNull;
                              if (first != null) loadSlots(x, first);
                            },
                          ),
                      ],
                    ),
                    if (c != null && ts.isNotEmpty) ...[
                      label('Visit'),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final x in ts)
                            FilterChipButton(
                              label: '${x.name} · ${(x.durationUnits ?? 0) * 10} min',
                              on: x.id == t?.id,
                              onTap: () {
                                setState(() => typeId = x.id);
                                loadSlots(c, x);
                              },
                            ),
                        ],
                      ),
                      label('Time'),
                      if (days == null)
                        const Padding(
                          padding: EdgeInsets.all(20),
                          child: Center(child: LoadingIndicator(size: 32)),
                        )
                      else if (days!.isEmpty)
                        Text('No free time in the next two weeks.', style: AtriaType.body(color: AtriaColors.inkMuted))
                      else ...[
                        SizedBox(
                          height: 44,
                          child: ListView(
                            scrollDirection: Axis.horizontal,
                            children: [
                              for (final d in days!.keys)
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: FilterChipButton(
                                    label: ClinicClock.day(ClinicClock.onDate(d)),
                                    on: d == day,
                                    onTap: () => setState(() {
                                      day = d;
                                      slot = null;
                                    }),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final s in days![day] ?? const <DateTime>[])
                              FilterChipButton(
                                label: ClinicClock.time(s),
                                on: s == slot,
                                onTap: () => setState(() => slot = s),
                              ),
                          ],
                        ),
                      ],
                    ],
                    if (failure != null) ...[const SizedBox(height: 14), Notice(failure!, tone: NoticeTone.error)],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                child: PrimaryButton(
                  label: slot == null ? 'Book' : 'Book ${ClinicClock.day(slot!)}, ${ClinicClock.time(slot!)}',
                  busy: busy,
                  onPressed: ready && !busy ? () => book(c, t) : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Find a patient for a booking: the register's search in a sheet.
Future<RegisterEntry?> pickPatient(BuildContext context, Api api) => showModalBottomSheet<RegisterEntry>(
  context: context,
  useRootNavigator: true,
  isScrollControlled: true,
  showDragHandle: true,
  backgroundColor: AtriaColors.surfacePanel,
  builder: (_) => _Pick(api: api),
);

class _Pick extends StatefulWidget {
  const _Pick({required this.api});
  final Api api;

  @override
  State<_Pick> createState() => _PickState();
}

class _PickState extends State<_Pick> {
  final query = TextEditingController();
  List<RegisterEntry> found = const [];
  Timer? wait;

  @override
  void dispose() {
    wait?.cancel();
    query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .7,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Find a patient', style: AtriaType.display(size: 21)),
              const SizedBox(height: 12),
              SearchSuggest(
                controller: query,
                groups: const [],
                autofocus: true,
                placeholder: 'Name, mobile or RHB number',
                onChanged: (v) {
                  wait?.cancel();
                  wait = Timer(const Duration(milliseconds: 300), () async {
                    if (v.trim().isEmpty) return setState(() => found = const []);
                    final r = await widget.api.get('/patients?q=${Uri.encodeQueryComponent(v.trim())}');
                    if (mounted) {
                      setState(
                        () => found = (r['results'] as List? ?? const [])
                            .cast<Map<String, dynamic>>()
                            .map(RegisterEntry.new)
                            .toList(),
                      );
                    }
                  });
                },
              ),
              const SizedBox(height: 10),
              Expanded(
                child: ListView(
                  children: [
                    for (final p in found)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Initials(initials(p.given, p.family), size: 38),
                        title: Text(
                          p.name,
                          style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                        ),
                        subtitle: Text([p.number, p.phone].whereType<String>().join(' · ')),
                        onTap: () => Navigator.pop(context, p),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
