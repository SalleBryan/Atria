/**
 * The queue's three rules, set by level (ADR 0022): how long the next free doctor is held for a
 * booked patient who was passed over, how long after a window a patient counts as late, and how
 * many times someone who is here may be called ahead of a booked patient who has not arrived.
 *
 * The tenant sets defaults (Settings), a unit overrides them (its manager) and the desk adjusts
 * one session for the day. This dialog is the unit's and the session's: each rule either uses
 * what the level above says or is set here. The server says which level set each rule.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../api/client";
import { Notice } from "../components/controls";
import { Close, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LoadingPane } from "../components/LoadingPane";
import { SelectMenu } from "../components/Pickers";
import { sentence } from "./labels";

export interface QueuePolicy {
  holdMinutes: number;
  lateGraceMinutes: number;
  maxBypass: number;
  inviteLeadMinutes: number;
  inviteFanout: number;
  inviteOpenMinutes: number;
  earlyCallInvites: "desk" | "auto";
  source: Record<string, string>;
}

type NumberKnob = "holdMinutes" | "lateGraceMinutes" | "maxBypass" | "inviteLeadMinutes" | "inviteFanout" | "inviteOpenMinutes";
type Knob = NumberKnob | "earlyCallInvites";
type Level = "unit" | "session";

const INHERIT = "inherit";

export const KNOBS: { name: NumberKnob; title: string; help: string; values: number[]; show: (n: number) => string }[] = [
  {
    name: "holdMinutes",
    title: "Hold the doctor for a booked patient",
    help: "After a booked patient who is not here has been passed over, the next free doctor waits this long for them while the desk phones.",
    values: [0, 1, 2, 3, 5, 8, 10, 15, 20, 30],
    show: (n) => (n === 0 ? "Do not hold" : `${n} min`),
  },
  {
    name: "lateGraceMinutes",
    title: "Late after the window ends",
    help: "How long after a patient's arrival window ends they count as late and go behind everyone who is here.",
    values: [0, 5, 10, 15, 20, 30, 45, 60],
    show: (n) => `${n} min`,
  },
  {
    name: "maxBypass",
    title: "Times a booked patient may be passed over",
    help: "How many times someone who is here may be called ahead of a booked patient whose window has opened and who has not arrived.",
    values: [0, 1, 2, 3],
    show: (n) => (n === 0 ? "Never, hold at once" : n === 1 ? "Once" : n === 2 ? "Twice" : "Three times"),
  },
  {
    name: "inviteLeadMinutes",
    title: "Invite early this long before a doctor is free",
    help: "A booked patient who is not here is asked to come earlier when a doctor is free, or will be within this long, and nobody is waiting.",
    values: [0, 3, 5, 10, 15, 20, 30],
    show: (n) => (n === 0 ? "Only when free" : `${n} min`),
  },
  {
    name: "inviteFanout",
    title: "Invitations out at once",
    help: "How many booked patients may be invited at the same time. None means no invitations are sent.",
    values: [0, 1, 2, 3, 4, 5, 8, 10],
    show: (n) => (n === 0 ? "None" : String(n)),
  },
  {
    name: "inviteOpenMinutes",
    title: "How long an invitation stays open",
    help: "The time the patient is asked to arrive within. An answer after it is refused; nobody loses their place either way.",
    values: [5, 10, 15, 20, 30, 45, 60, 90, 120],
    show: (n) => `${n} min`,
  },
];

/** Who sends invitations: the one rule that is a choice and not a number. */
export const INVITE_MODE = {
  name: "earlyCallInvites" as const,
  title: "Who sends invitations",
  help: "The desk sends them with a button, or the system sends them by itself when its rules allow. Either way the doctor is never held and nobody is moved.",
  options: [
    { id: "desk", label: "The desk sends them" },
    { id: "auto", label: "Automatically" },
  ],
};

/** Every rule the dialog edits, numbers first and the invitation mode last, in one shape. */
const RULES: { name: Knob; title: string; help: string; options: { id: string; label: string }[]; show: (v: number | string) => string }[] =
  [
    ...KNOBS.map((k) => ({
      name: k.name as Knob,
      title: k.title,
      help: k.help,
      options: k.values.map((n) => ({ id: String(n), label: k.show(n) })),
      show: k.show as (v: number | string) => string,
    })),
    {
      name: INVITE_MODE.name,
      title: INVITE_MODE.title,
      help: INVITE_MODE.help,
      options: INVITE_MODE.options,
      show: ((v: string) => INVITE_MODE.options.find((o) => o.id === v)?.label ?? v) as (v: number | string) => string,
    },
  ];
const ALL = RULES.map((r) => r.name);
const blank = () => Object.fromEntries(ALL.map((name) => [name, INHERIT])) as Record<Knob, string>;

const LEVEL_NAMES: Record<string, string> = {
  session: "this session",
  unit: "this unit",
  tenant: "the hospital's settings",
  default: "the built-in default",
};

export function QueueRulesDialog({
  level,
  path,
  title,
  initial,
  onClose,
  onDone,
}: {
  level: Level;
  /** The unit's or the session's policy route. */
  path: string;
  title: string;
  /** The session's policy as the live queue gave it; a unit's is read from the server. */
  initial?: QueuePolicy;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [policy, setPolicy] = useState<QueuePolicy | null>(initial ?? null);
  const [chosen, setChosen] = useState<Record<Knob, string>>(() => blank());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let live = true;
    api<QueuePolicy>(path)
      .then((found) => live && setPolicy(found))
      .catch(() => live && setFailure("The rules could not be loaded."));
    return () => {
      live = false;
    };
  }, [initial, path]);

  // What each rule is set to at this level now: its own value, or inherited.
  const current = useMemo<Record<Knob, string>>(() => {
    const own = (name: Knob) => (policy && policy.source[name] === level ? String(policy[name]) : INHERIT);
    return Object.fromEntries(ALL.map((name) => [name, own(name)])) as Record<Knob, string>;
  }, [policy, level]);
  useEffect(() => setChosen(current), [current]);

  const changed = ALL.filter((name) => chosen[name] !== current[name]);

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const body: Record<string, number | string | null> = {};
      for (const name of changed) {
        const value = chosen[name];
        body[name] = value === INHERIT ? null : name === "earlyCallInvites" ? value : Number(value);
      }
      await api(path, { method: "PATCH", json: body });
      onDone(level === "session" ? "The rules for this session are saved." : "The unit's queue rules are saved.");
    } catch (caught) {
      setFailure(`${sentence(caught instanceof Error ? caught.message : "That did not go through")} Nothing was changed.`);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="dialog staff-dialog move-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="move-scroll">
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Close size={16} />
          </button>
          <span className="dialog-icon dialog-icon-blue" aria-hidden="true">
            <Users size={22} />
          </span>
          <h2 id="rules-title">{title}</h2>
          <p className="dialog-lede">
            {level === "session"
              ? "These apply to this session only. Anything you leave on the default follows the unit and the hospital."
              : "These apply to every session in this unit unless the desk adjusts one. Anything you leave on the default follows the hospital's settings."}
          </p>
          {!policy ? (
            <LoadingPane label="Loading the rules" />
          ) : (
            <div className="settings-dialog-form">
              {RULES.map((k, index) => {
                const inherited = chosen[k.name] === INHERIT;
                const above = policy.source[k.name] === level ? "the level above" : LEVEL_NAMES[policy.source[k.name] ?? "default"];
                return (
                  <Fragment key={k.name}>
                    {index === KNOBS.findIndex((x) => x.name === "inviteLeadMinutes") && (
                      <p className="settings-label queue-rules-group">Early-call invitations</p>
                    )}
                    <div className="off-field">
                      <span>{k.title}</span>
                      <SelectMenu
                        label={k.title}
                        value={chosen[k.name]}
                        width={260}
                        options={[{ id: INHERIT, label: "Use the default" }, ...k.options]}
                        onChange={(id) => setChosen((c) => ({ ...c, [k.name]: id }))}
                      />
                      <small className="queue-rule-help">
                        {k.help} {inherited ? `Now ${k.show(policy[k.name])}, set by ${above}.` : ""}
                      </small>
                    </div>
                  </Fragment>
                );
              })}
              {failure && <Notice tone="error">{failure}</Notice>}
            </div>
          )}
          {!policy && failure && <Notice tone="error">{failure}</Notice>}
        </div>
        <div className="dialog-actions move-actions">
          <button type="button" className="outline-button keep" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="staff-primary"
            disabled={!policy || changed.length === 0 || busy}
            aria-busy={busy || undefined}
            onClick={() => void save()}
          >
            {busy ? <LoadingIndicator size={20} label="Saving" /> : null}
            {busy ? "Saving" : "Save the rules"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
