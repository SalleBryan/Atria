import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../patient/data.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import '../ui/expressive.dart';
import '../ui/glass.dart';
import '../ui/icons.dart';
import 'data.dart';

/// The parts the staff screens share, in the Rev A look of the patient app
/// and the web console: glass on the blue field, blue for booked, green for
/// arrived, amber for what needs a decision, red for cancelled.

Color toneInk(StaffTone t) => switch (t) {
  StaffTone.booked => AtriaColors.bookedInk,
  StaffTone.confirmed => AtriaColors.confirmedInk,
  StaffTone.awaiting => AtriaColors.awaitingInk,
  StaffTone.cancelled => AtriaColors.cancelledInk,
  StaffTone.neutral => AtriaColors.ink700,
};

Color toneFill(StaffTone t) => switch (t) {
  StaffTone.booked => AtriaColors.blue600,
  StaffTone.confirmed => AtriaColors.confirmed,
  StaffTone.awaiting => AtriaColors.awaiting,
  StaffTone.cancelled => AtriaColors.cancelled,
  StaffTone.neutral => AtriaColors.ink400,
};

/// A state as the desk reads it, in a small tinted chip.
class StateChip extends StatelessWidget {
  const StateChip(this.label, this.tone, {super.key});
  StateChip.of(String state, {Key? key}) : this(staffState(state).$1, staffState(state).$2, key: key);
  final String label;
  final StaffTone tone;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(color: toneFill(tone).withValues(alpha: .13), borderRadius: BorderRadius.circular(99)),
    child: Text(
      label.toUpperCase(),
      semanticsLabel: label,
      style: AtriaType.body(
        size: 11,
        weight: FontWeight.w700,
        color: toneInk(tone),
        height: 1.2,
      ).copyWith(letterSpacing: .44),
    ),
  );
}

/// The top of a console screen: its title, a line under it, and an action.
class StaffHeader extends StatelessWidget {
  const StaffHeader({super.key, required this.title, this.sub, this.trailing, this.back});
  final String title;
  final String? sub;
  final Widget? trailing;

  /// Where the back button goes; none on a top-level place.
  final String? back;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      if (back != null) ...[
        Glass(
          radius: 16,
          height: 46,
          semanticLabel: 'Back',
          onTap: () => context.canPop() ? context.pop() : context.go(back!),
          child: const SizedBox(
            width: 46,
            child: Center(child: AtriaIcon('chevronLeft', size: 19, color: AtriaColors.ink800)),
          ),
        ),
        const SizedBox(width: 12),
      ],
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(header: true, child: Text(title, style: AtriaType.display(size: 26))),
            if (sub != null) ...[
              const SizedBox(height: 3),
              Text(sub!, style: AtriaType.body(size: 13, color: AtriaColors.inkMuted)),
            ],
          ],
        ),
      ),
      ?trailing,
    ],
  );
}

/// A figure on the day: a tinted icon, the number, what it counts.
class FigureTile extends StatelessWidget {
  const FigureTile({super.key, required this.icon, required this.value, required this.label, required this.colours});
  final String icon;
  final int value;
  final String label;
  final List<Color> colours;

  @override
  Widget build(BuildContext context) => Glass(
    radius: 22,
    padding: const EdgeInsets.all(14),
    child: Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(gradient: cssGradient(145, colours), borderRadius: BorderRadius.circular(14)),
          child: Center(child: AtriaIcon(icon, size: 18, color: Colors.white)),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$value', style: AtriaType.display(size: 22)),
              Text(label, maxLines: 2, style: AtriaType.body(size: 11.5, color: AtriaColors.inkMuted, height: 1.25)),
            ],
          ),
        ),
      ],
    ),
  );
}

const toneBlue = [Color(0xFF5B8DF2), Color(0xFF2A62DC)];
const toneGreen = [Color(0xFF34C08A), Color(0xFF0E9C6B)];
const toneRed = [Color(0xFFF07A7A), Color(0xFFC93C3C)];
const toneAmber = [Color(0xFFF2B24C), Color(0xFFD1850F)];

/// Back a day, the date, forward a day, and Today when away from it.
class DateBar extends StatelessWidget {
  const DateBar({super.key, required this.label, required this.onPrevious, required this.onNext, this.onToday});
  final String label;
  final VoidCallback onPrevious;
  final VoidCallback onNext;
  final VoidCallback? onToday;

  @override
  Widget build(BuildContext context) => Glass(
    radius: 20,
    padding: const EdgeInsets.all(6),
    child: Row(
      children: [
        _Square(icon: 'chevronLeft', label: 'Previous', onTap: onPrevious),
        Expanded(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: AtriaType.display(size: 15.5, weight: FontWeight.w600).copyWith(letterSpacing: 0),
          ),
        ),
        if (onToday != null) ...[
          Pressable(
            onTap: onToday,
            radius: 12,
            ink: AtriaColors.blue700,
            semanticLabel: 'Today',
            builder: (context, _) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Text(
                'Today',
                style: AtriaType.body(size: 13, weight: FontWeight.w700, color: AtriaColors.blue600),
              ),
            ),
          ),
          const SizedBox(width: 4),
        ],
        _Square(icon: 'chevronRight', label: 'Next', onTap: onNext),
      ],
    ),
  );
}

class _Square extends StatelessWidget {
  const _Square({required this.icon, required this.label, required this.onTap});
  final String icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    radius: 14,
    ink: AtriaColors.blue700,
    semanticLabel: label,
    builder: (context, _) => Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AtriaColors.lineHairline),
      ),
      child: Center(child: AtriaIcon(icon, size: 17, color: AtriaColors.ink800)),
    ),
  );
}

/// A person's initials on the blue gradient.
class Initials extends StatelessWidget {
  const Initials(this.text, {super.key, this.size = 42});
  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      gradient: cssGradient(145, toneBlue, [.141, .859]),
      borderRadius: BorderRadius.circular(size * .34),
    ),
    child: Text(
      text.isEmpty ? '?' : text.toUpperCase(),
      style: AtriaType.display(size: size * .36, weight: FontWeight.w600, color: Colors.white),
    ),
  );
}

/// One visit in a staff list: time, patient, what and with whom, its state.
class VisitLine extends StatelessWidget {
  const VisitLine({super.key, required this.appointment, required this.name, required this.detail, this.onTap});
  final Appointment appointment;
  final String name;
  final String detail;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final due = noShowDue(a);
    return Glass(
      radius: 20,
      onTap: onTap,
      semanticLabel: '$name at ${ClinicClock.time(a.startAt)}',
      padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
      child: Row(
        children: [
          SizedBox(
            width: 54,
            child: Column(
              children: [
                Text(ClinicClock.time(a.startAt), style: AtriaType.display(size: 15.5, weight: FontWeight.w600)),
                Text(
                  ClinicClock.time(a.endAt),
                  style: AtriaType.body(size: 11.5, color: AtriaColors.inkSoft, height: 1.2),
                ),
              ],
            ),
          ),
          Container(
            width: 3,
            height: 38,
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(color: toneFill(staffState(a.state).$2), borderRadius: BorderRadius.circular(2)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 14.5, weight: FontWeight.w700, color: AtriaColors.ink900),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AtriaType.body(size: 12, color: AtriaColors.inkSoft, height: 1.3),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          due ? const StateChip('No-show?', StaffTone.awaiting) : StateChip.of(a.state),
        ],
      ),
    );
  }
}
