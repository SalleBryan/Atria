/**
 * Form controls from the Atria component library: Text input, Button,
 * Checkbox, Notice and Status pill, with the Rev A sizes (54px inputs, 58px
 * primary buttons, 17px and 19px radii) and Material 3 Expressive motion
 * (src/styles/motion.css): state layers, ripples, a pressed shape morph, a
 * check mark that draws itself, and errors that arrive rather than appear.
 */

import {
  type ComponentType,
  type InputHTMLAttributes,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Alert, CheckMark, Eye, EyeOff, Info } from "./icons";
import { LoadingIndicator } from "./LoadingIndicator";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  hint?: string;
  error?: string;
  revealable?: boolean;
}

export function Field({ label, icon: IconComponent, hint, error, revealable, type, className, ...input }: FieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  // A new error nudges the field, so the eye finds what needs fixing.
  useEffect(() => {
    const element = box.current;
    if (!error || !element) return;
    element.classList.remove("input-nudge");
    void element.offsetWidth; // restart the animation
    element.classList.add("input-nudge");
  }, [error]);

  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div ref={box} className={`input${error ? " input-invalid" : ""}`}>
        {IconComponent && (
          <span className="input-icon">
            <IconComponent size={17} />
          </span>
        )}
        <input
          id={id}
          type={revealable && revealed ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          {...input}
        />
        {revealable && (
          <button
            type="button"
            className="input-reveal"
            onClick={() => setRevealed((shown) => !shown)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
          >
            {/* Keyed, so the new icon turns in rather than swapping. */}
            <span key={String(revealed)} className="swap-in">
              {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
            </span>
          </button>
        )}
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

/**
 * Material's ripple: a wave from where the pointer went down. Measured in the
 * button's own coordinates, because the screen may be zoomed to fit
 * (src/layout/fit.ts) and the pointer arrives in the window's.
 */
function useRipples() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const next = useRef(0);
  function start(event: PointerEvent<HTMLElement>) {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const scale = target.offsetWidth ? rect.width / target.offsetWidth : 1;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    const size = Math.hypot(Math.max(x, target.offsetWidth - x), Math.max(y, target.offsetHeight - y)) * 2;
    const id = (next.current += 1);
    setRipples((current) => [...current, { id, x, y, size }]);
    window.setTimeout(() => setRipples((current) => current.filter((ripple) => ripple.id !== id)), 700);
  }
  const layer = ripples.map((ripple) => (
    <span
      key={ripple.id}
      className="ripple"
      aria-hidden="true"
      style={{ left: ripple.x - ripple.size / 2, top: ripple.y - ripple.size / 2, width: ripple.size, height: ripple.size }}
    />
  ));
  return { start, layer };
}

interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
}

export function Button({ children, variant = "primary", type = "button", disabled, busy, onClick }: ButtonProps) {
  const { start, layer } = useRipples();
  return (
    <button
      type={type}
      className={`button button-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
      onPointerDown={disabled || busy ? undefined : start}
    >
      {layer}
      {busy ? <LoadingIndicator size={22} label="Working" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="checkbox-box" aria-hidden="true">
        <CheckMark size={13} />
      </span>
      <span>{children}</span>
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const IconComponent = tone === "error" ? Alert : tone === "success" ? CheckMark : Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <IconComponent size={17} />
      <div>{children}</div>
    </div>
  );
}

export function StatusPill({
  tone,
  icon: IconComponent,
  children,
}: {
  tone: "awaiting" | "booked";
  icon?: ComponentType<{ size?: number }>;
  children: ReactNode;
}) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      {IconComponent && <IconComponent size={13} />}
      {children}
    </span>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="divider" role="separator">
      <span>{children}</span>
    </div>
  );
}
