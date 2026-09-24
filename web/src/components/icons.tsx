/** Line icons drawn to match the Rev A set: round caps, strokes, no fills. */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 17, strokeWidth = 1.6, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The Atria mark: a pulse line. */
export const Pulse = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="M2 12h4.5l2.5-5 4 10 2.5-5H22" />
  </Icon>
);
export const Mail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
);
export const Lock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
  </Icon>
);
export const Eye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const EyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.5M6.3 6.3A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.7-1.8" />
    <path d="m3 3 18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);
export const Phone = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
);
export const User = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const Key = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
  </Icon>
);
export const Calendar = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
export const Bell = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);
export const Shield = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6Z" />
  </Icon>
);
export const Check = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
/**
 * A check drawn as one stroke with a path length of 1, so CSS can draw it in
 * (stroke-dashoffset 1 to 0) when a box is ticked or a rule is met.
 */
export const CheckMark = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path className="check-path" pathLength={1} d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const Info = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.2" />
  </Icon>
);
export const Alert = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.5M12 17.3v.2" />
  </Icon>
);
export const ArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
export const Home = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19Z" />
  </Icon>
);
export const Search = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);
export const Plus = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Repeat = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
    <path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
    <path d="M4 20v-4.5h4.5" />
  </Icon>
);
export const Clipboard = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <rect x="5" y="4.5" width="14" height="16" rx="2.5" />
    <path d="M9 4.5V3.5h6v1M9 10h6M9 14h6M9 18h3" />
  </Icon>
);
export const Pin = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);
export const Clock = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const Download = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);
export const ChevronRight = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);
export const ChevronLeft = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);
export const SignOut = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M10 8 6 12l4 4M6 12h9.5" />
  </Icon>
);
export const Close = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Icon>
);
export const Filter = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M4.5 7h15M7.5 12h9M10.5 17h3" />
  </Icon>
);
export const Stethoscope = (p: IconProps) => (
  <Icon strokeWidth={1.75} {...p}>
    <path d="M6 3.5v5a4 4 0 0 0 8 0v-5" />
    <path d="M10 12.5v2a5 5 0 0 0 10 0v-2" />
    <circle cx="20" cy="10.5" r="2" />
  </Icon>
);
