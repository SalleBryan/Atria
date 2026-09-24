/**
 * Six one-digit boxes for an emailed code, from "Desktop · Verify email".
 *
 * Typing moves forward, Backspace moves back, the arrow keys move either way,
 * and pasting the whole code fills every box. The first box carries
 * autocomplete="one-time-code" so a phone can offer the code from the email.
 */

import { type ClipboardEvent, type KeyboardEvent, useRef } from "react";

export const CODE_LENGTH = 6;

export function CodeInput({
  value,
  onChange,
  label,
  invalid,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // Held as six fixed positions, a space for an empty box, so clearing one
  // box never shifts the digits after it.
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => (value[index] ?? " ").trim());
  const emit = (next: string[]) => onChange(next.map((digit) => digit || " ").join(""));

  const focus = (index: number) => boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();

  function put(index: number, typed: string) {
    const clean = typed.replace(/\D/g, "");
    if (!clean) return;
    const next = [...digits];
    for (let offset = 0; offset < clean.length && index + offset < CODE_LENGTH; offset += 1) {
      next[index + offset] = clean[offset] as string;
    }
    emit(next);
    focus(index + clean.length);
  }

  function key(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...digits];
      if (next[index]) next[index] = "";
      else if (index > 0) {
        next[index - 1] = "";
        focus(index - 1);
      }
      emit(next);
    } else if (event.key === "ArrowLeft") focus(index - 1);
    else if (event.key === "ArrowRight") focus(index + 1);
  }

  function paste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    put(index, event.clipboardData.getData("text"));
  }

  return (
    <div className="code" role="group" aria-label={label}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          className={`code-box${digit ? " code-filled" : ""}`}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={CODE_LENGTH}
          aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          value={digit}
          onChange={(event) => {
            const typed = event.target.value;
            put(index, digit && typed.length > 1 && typed.startsWith(digit) ? typed.slice(1) : typed);
          }}
          onKeyDown={(event) => key(index, event)}
          onPaste={(event) => paste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}

/** True once every box holds a digit. */
export function isComplete(code: string): boolean {
  return /^\d{6}$/.test(code);
}
