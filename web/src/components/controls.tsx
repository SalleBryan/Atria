/**
 * Form controls from the Atria component library: Text input, Button,
 * Checkbox, Notice and Status pill, with the Rev A sizes (54px inputs, 58px
 * primary buttons, 17px and 19px radii).
 */

import { type ComponentType, type InputHTMLAttributes, type ReactNode, useId, useState } from "react";

import { Alert, Check, Eye, EyeOff, Info } from "./icons";

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
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`input${error ? " input-invalid" : ""}`}>
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
            {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
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

interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
}

export function Button({ children, variant = "primary", type = "button", disabled, busy, onClick }: ButtonProps) {
  return (
    <button
      type={type}
      className={`button button-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
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
        <Check size={12} />
      </span>
      <span>{children}</span>
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const IconComponent = tone === "error" ? Alert : tone === "success" ? Check : Info;
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
