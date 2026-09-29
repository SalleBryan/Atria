/**
 * The front page below its first screen (feedback 2026-09-29): what Atria is,
 * how to use it, what happens around a visit, who sees what, the staff side,
 * and the questions people ask first. The hero above stays as it was.
 *
 * Told as a story you scroll through, on Material 3 Expressive motion: an
 * editorial photo stage with the three ways to be seen, a phone that plays
 * the four steps while the steps scroll past it, the hospital's units running
 * by, small live scenes for the things around a visit, and a lock in a
 * morphing M3 shape beside who sees what.
 *
 * Everything said here is what the platform does today. The institution's
 * name and units come from the tenant profile, never a literal. The two
 * photographs are Unsplash License stock, cropped and blurred so no name or
 * crest shows; neither stands for anyone at the hospital.
 */

import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import appleCalendar from "../assets/apple.svg";
import doctorPhone from "../assets/doctor-phone.webp";
import googleCalendar from "../assets/google-calendar.svg";
import outlook from "../assets/outlook.svg";
import {
  ArrowUpRight,
  Bell,
  Building,
  Calendar,
  Check,
  Clipboard,
  Clock,
  Globe,
  Lock,
  Mail,
  Phone,
  Pulse,
  Repeat,
  Search,
  Shield,
  Stethoscope,
  Undo,
  User,
  Users,
} from "../components/icons";
import { UNITS } from "../generated/hospital";
import { TENANT } from "../tenant";

/** Adds `in` once the element scrolls into view, for the rise-in motion. */
function useSeen<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

function Reveal({
  children,
  className = "",
  index = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  as?: "div" | "li" | "section";
}) {
  const [ref, seen] = useSeen<HTMLDivElement>(0.15);
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${seen ? "reveal-in" : ""} ${className}`}
      style={{ "--i": index } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Headline words that rise one after another, on the expressive spring. */
export function Rise({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [ref, seen] = useSeen<HTMLSpanElement>(0.3);
  return (
    <span
      ref={ref}
      className={`rise ${seen ? "rise-in" : ""} ${className ?? ""}`}
    >
      {text.split(" ").map((word, index) => (
        <Fragment key={index}>
          <span className="rise-mask">
            <span
              className="rise-word"
              style={{ "--w": index } as CSSProperties}
            >
              {word}
            </span>
          </span>{" "}
        </Fragment>
      ))}
    </span>
  );
}

const WAYS = [
  {
    key: "specialist",
    chip: "Specialist",
    icon: Stethoscope,
    title: "Book a specialist",
    body: "Choose a clinician by name, specialty, unit or the language they consult in, pick a day and a free time, and it is yours. A time is only held once you confirm it, so nobody else can take it from under you.",
  },
  {
    key: "today",
    chip: "Today",
    icon: Users,
    title: "See a doctor today",
    body: "Join the outpatient department's queue for today or a day ahead. You get a place and a window to arrive in, and a text if the queue moves, so you are not waiting on a bench all morning.",
  },
  {
    key: "procedure",
    chip: "Procedure",
    icon: Clipboard,
    title: "Request a procedure",
    body: "Ask a unit for a minor procedure in a few words. The unit sizes it and offers you a time; nothing is booked until you confirm it.",
  },
];

const STEPS = [
  {
    icon: User,
    title: "Create your account",
    body: "With your email or your Google account. Add your mobile number and date of birth, so reminders reach you and the right rules apply to you.",
  },
  {
    icon: Search,
    title: "Find care",
    body: "Search as you would say it: a name, a specialty, a unit. Filter by unit and language, and see who has an opening today.",
  },
  {
    icon: Calendar,
    title: "Book, or join the queue",
    body: "Pick a time, or take a place in today's queue. Some visits ask a few questions first, so your clinician knows why you are coming.",
  },
  {
    icon: Bell,
    title: "Be reminded",
    body: "A text and an email reach you a day before. Move or cancel from the app if your plans change, and the time goes to someone else.",
  },
];

const PRIVACY = [
  {
    icon: Lock,
    title: "Your answers stay with your clinician",
    body: "What you write before a visit is read only by you and the clinician you are seeing. The front desk and the hospital's administrators cannot open it, and it is deleted 90 days after the visit.",
  },
  {
    icon: Shield,
    title: "Only your hospital",
    body: `Your record is shared with ${TENANT.name} and nobody else. Every time staff open it, it is written in the hospital's audit log.`,
  },
  {
    icon: Undo,
    title: "Yours to delete",
    body: "Delete your account from its settings whenever you like. You have 30 days to change your mind before it is erased.",
  },
];

const QUESTIONS = [
  {
    q: "Does Atria cost anything?",
    a: "No. Atria is how you book. The visit's fee is the hospital's, and you pay it at the hospital as you always have; nothing is charged or paid through Atria.",
  },
  {
    q: "What if I don't have a smartphone?",
    a: "The front desk books for you by phone or in person, and reminders come by text to any mobile.",
  },
  {
    q: "What happens if I'm late or can't come?",
    a: "Cancel in the app as early as you can: the time goes to someone else. A queue place keeps its window, and a text tells you if it moves.",
  },
  {
    q: "Which languages can I use?",
    a: "The screens are in English today. You can choose French for your texts and emails, and see which clinicians consult in French or English.",
  },
];

/* ------------------------------------------------------------ ways stage */

function WayScene({ way }: { way: string }) {
  if (way === "specialist")
    return (
      <span className="way-scene">
        <span className="way-slots">
          {["09:30", "10:15", "11:00", "14:00"].map((t, i) => (
            <span
              key={t}
              className={`way-slot ${i === 1 ? "on" : ""}`}
              style={{ "--i": i } as CSSProperties}
            >
              {t}
            </span>
          ))}
        </span>
        <span className="way-foot">
          <Check size={14} /> Held for you once you confirm
        </span>
      </span>
    );
  if (way === "today")
    return (
      <span className="way-scene way-ticket">
        <span className="way-ticket-no">
          <small>YOUR PLACE</small>
          <b>A-14</b>
        </span>
        <span className="way-ticket-window">
          <small>ARRIVE BETWEEN</small>
          <b>10:40 and 11:10</b>
        </span>
      </span>
    );
  return (
    <span className="way-scene way-request">
      {["Sent", "Sized by the unit", "Time offered"].map((s, i) => (
        <span
          key={s}
          className={`way-state ${i < 2 ? "done" : ""}`}
          style={{ "--i": i } as CSSProperties}
        >
          <span className="way-state-dot">
            {i < 2 ? <Check size={11} /> : null}
          </span>
          {s}
        </span>
      ))}
    </span>
  );
}

function WaysStage() {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  // Plays through the three ways until someone chooses one.
  useEffect(() => {
    if (held) return;
    const timer = window.setInterval(
      () => setActive((a) => (a + 1) % WAYS.length),
      5200,
    );
    return () => window.clearInterval(timer);
  }, [held]);
  const way = WAYS[active]!;
  const Icon = way.icon;
  return (
    <section className="stage" id="about" aria-labelledby="about-title">
      <div className="stage-photo" aria-hidden="true">
        <img
          src={doctorPhone}
          alt=""
          width="1600"
          height="1067"
          loading="lazy"
        />
      </div>
      <div className="stage-copy">
        <p className="more-eyebrow on-dark">WHAT ATRIA IS</p>
        <h2 id="about-title" className="stage-title">
          <Rise text="Three ways to be seen" />
          <span className="stage-title-small">at {TENANT.name}.</span>
        </h2>
        <p className="stage-lede">
          Atria is the hospital's own booking service. It keeps one calendar for
          every unit, so the time you see is the time you get, and the hospital
          knows you are coming.
        </p>
      </div>

      <Reveal className="stage-card">
        <div className="way-chips" role="tablist" aria-label="Ways to be seen">
          {WAYS.map((w, i) => (
            <button
              key={w.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`way-chip ${i === active ? "on" : ""}`}
              onClick={() => {
                setHeld(true);
                setActive(i);
              }}
            >
              {w.chip}
            </button>
          ))}
        </div>
        <div className="way-body" key={way.key} role="tabpanel">
          <span className="way-icon" aria-hidden="true">
            <Icon size={22} />
          </span>
          <h3>{way.title}</h3>
          <p>{way.body}</p>
          <WayScene way={way.key} />
        </div>
        {!held && (
          <span className="way-progress" aria-hidden="true">
            <span key={active} />
          </span>
        )}
      </Reveal>

      <Reveal className="stage-tile" index={1}>
        <span className="stage-tile-number">{UNITS.length}</span>
        <span className="stage-tile-text">
          units,
          <br />
          one calendar
        </span>
        <Building size={64} className="stage-tile-art" />
      </Reveal>

      <Reveal className="stage-statement" index={2}>
        <p>The time you see is the time you get.</p>
        <a href="#how" className="stage-more">
          See how it works <ArrowUpRight size={16} />
        </a>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------ phone story */

function Screen({ step }: { step: number }) {
  const esther = "Dr Esther Mbarga";
  switch (step) {
    case 0:
      return (
        <div className="scr">
          <p className="scr-title">Create your account</p>
          <span className="scr-google">
            <b>G</b> Continue with Google
          </span>
          <span className="scr-or">or</span>
          <span className="scr-field">
            <Mail size={13} /> you@example.com
          </span>
          <span className="scr-field">
            <span className="scr-flag">+237</span> 6 70 00 00 00
          </span>
          <span className="scr-field">
            <Calendar size={13} /> 14 / 03 / 1994
          </span>
          <span className="scr-button">Create account</span>
        </div>
      );
    case 1:
      return (
        <div className="scr">
          <span className="scr-search">
            <Search size={13} /> Paediatrics
          </span>
          <span className="scr-chips">
            <span className="on">All units</span>
            <span>English</span>
            <span>French</span>
          </span>
          {[esther, "Dr Jean-Paul Nkoulou", "Dr Aicha Bello"].map((n, i) => (
            <span
              key={n}
              className="scr-row"
              style={{ "--i": i } as CSSProperties}
            >
              <span className="scr-avatar">
                {n.split(" ")[1]![0]}
                {n.split(" ").pop()![0]}
              </span>
              <span className="scr-row-text">
                <b>{n}</b>
                <small>{["Paediatrics", "Cardiology", "Dermatology"][i]}</small>
              </span>
              {i === 0 && <span className="scr-badge">Today</span>}
            </span>
          ))}
        </div>
      );
    case 2:
      return (
        <div className="scr">
          <p className="scr-title">{esther}</p>
          <span className="scr-week">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
              <span key={d} className={i === 2 ? "on" : ""}>
                {d}
                <b>{7 + i}</b>
              </span>
            ))}
          </span>
          <span className="scr-slots">
            {["09:30", "10:00", "10:15", "11:30", "14:00", "15:10"].map((t) => (
              <span key={t} className={t === "10:00" ? "on" : ""}>
                {t}
              </span>
            ))}
          </span>
          <span className="scr-note">
            <Clipboard size={12} /> 2 short questions first
          </span>
          <span className="scr-button">Book Wednesday, 10:00</span>
        </div>
      );
    default:
      return (
        <div className="scr scr-lock">
          <span className="scr-clock">09:58</span>
          <span className="scr-date">Tuesday</span>
          <span className="scr-note-card" style={{ "--i": 0 } as CSSProperties}>
            <span className="scr-note-app">
              <Phone size={11} /> SMS · now
            </span>
            <b>Reminder: {esther}</b>
            <small>Tomorrow, 10:00 · Paediatrics Unit</small>
          </span>
          <span className="scr-note-card" style={{ "--i": 1 } as CSSProperties}>
            <span className="scr-note-app">
              <Mail size={11} /> Email · now
            </span>
            <b>Your visit tomorrow</b>
            <small>Move or cancel in Atria</small>
          </span>
        </div>
      );
  }
}

function Story() {
  const [step, setStep] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  // The step nearest the middle of the window is the one the phone plays.
  // Measured on every scroll (any scroller: the zoomed page, or the window on
  // a phone), so a fast scroll never skips a step.
  useEffect(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      // The pinned phone's centre, in the same units as the steps' boxes
      // (the window's own height is not, under the canvas zoom).
      const pin = items.current[0]
        ?.closest(".story-body")
        ?.querySelector(".story-pin");
      const frameBox = pin?.getBoundingClientRect();
      const middle = frameBox
        ? frameBox.top + frameBox.height / 2
        : window.innerHeight / 2;
      let best = 0;
      let nearest = Infinity;
      items.current.forEach((el, i) => {
        if (!el) return;
        const box = el.getBoundingClientRect();
        const distance = Math.abs(box.top + box.height / 2 - middle);
        if (distance < nearest) {
          nearest = distance;
          best = i;
        }
      });
      setStep(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    pick();
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <section className="story" id="how" aria-labelledby="how-title">
      <div className="story-head">
        <p className="more-eyebrow">HOW IT WORKS</p>
        <h2 id="how-title" className="big-title">
          <Rise text="From your phone to the right room, in four steps." />
        </h2>
      </div>
      <div className="story-body">
        <div className="story-pin" aria-hidden="true">
          <div className="phone">
            <span className="phone-notch" />
            <div className="phone-screen">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`phone-page ${i === step ? "on" : i < step ? "past" : ""}`}
                >
                  <Screen step={i} />
                </div>
              ))}
            </div>
          </div>
          <span
            className="story-glow"
            style={{ "--s": step } as CSSProperties}
          />
          <span className="story-dots">
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? "on" : ""} />
            ))}
          </span>
        </div>
        <ol className="story-steps">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              data-step={i}
              ref={(el) => {
                items.current[i] = el;
              }}
              className={`story-step ${i === step ? "on" : ""}`}
            >
              {/* On a phone each step carries its own screen. */}
              <div className="story-mini" aria-hidden="true">
                <div className="phone">
                  <span className="phone-notch" />
                  <div className="phone-screen">
                    <div className="phone-page on">
                      <Screen step={i} />
                    </div>
                  </div>
                </div>
              </div>
              <span className="story-number">0{i + 1}</span>
              <span className="story-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ units band */

function Marquee() {
  const names = UNITS.map((u) => u.name);
  const row = (reverse: boolean) => (
    <div className={`marquee-row ${reverse ? "reverse" : ""}`}>
      {[0, 1].map((copy) => (
        <span key={copy} className="marquee-track" aria-hidden={copy === 1}>
          {(reverse ? [...names].reverse() : names).map((n) => (
            <span key={n} className="marquee-item">
              {n}
              <Pulse size={26} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
  return (
    <section className="marquee" aria-label={`The units of ${TENANT.name}`}>
      {row(false)}
      {row(true)}
    </section>
  );
}

/* ------------------------------------------------------------ bento */

function Bento() {
  return (
    <section className="more-section" aria-labelledby="around-title">
      <div className="section-head">
        <p className="more-eyebrow">BEFORE AND AFTER YOUR VISIT</p>
        <h2 id="around-title" className="big-title">
          <Rise text="The small things that make a visit go well." />
        </h2>
      </div>
      <div className="bento">
        <Reveal className="tile tile-map">
          <svg
            className="map-art"
            viewBox="0 0 560 400"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <pattern
                id="map-grid"
                width="28"
                height="28"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M28 0H0V28"
                  fill="none"
                  stroke="rgba(47,107,228,.10)"
                />
              </pattern>
            </defs>
            <rect width="560" height="400" fill="url(#map-grid)" />
            {[
              [36, 30, 130, 80],
              [200, 24, 100, 120],
              [336, 40, 180, 70],
              [40, 150, 110, 110],
              [180, 190, 130, 70],
              [350, 150, 90, 120],
              [460, 140, 70, 90],
              [60, 300, 150, 60],
              [250, 290, 120, 80],
            ].map(([x, y, w, h], i) => (
              <rect
                key={i}
                x={x}
                y={y}
                width={w}
                height={h}
                rx="14"
                className="map-block"
              />
            ))}
            <path
              className="map-route"
              d="M24 372 C 150 372, 160 280, 230 280 S 330 190, 330 150 S 380 125, 432 118"
            />
            <circle cx="24" cy="372" r="8" className="map-start" />
            <g className="map-gate" transform="translate(40 336)">
              <rect width="56" height="26" rx="10" />
              <text x="28" y="17.5" textAnchor="middle">
                Gate
              </text>
            </g>
            <g transform="translate(432 118)">
              <g className="map-pin">
                <path d="M0 0 C -6 -10 -20 -18 -20 -32 A 20 20 0 1 1 20 -32 C 20 -18 6 -10 0 0 Z" />
                <circle cy="-32" r="7.5" />
              </g>
            </g>
          </svg>
          <div className="tile-text">
            <h3>The way to the right door</h3>
            <p>
              Every unit of {TENANT.name} is on the hospital map, with the
              building, the floor and walking directions from the gate.
            </p>
          </div>
        </Reveal>

        <Reveal className="tile tile-cal" index={1}>
          <span className="cal-fan" aria-hidden="true">
            <img src={googleCalendar} alt="" width="54" height="54" />
            <img src={outlook} alt="" width="54" height="54" />
            <img src={appleCalendar} alt="" width="54" height="54" />
          </span>
          <div className="tile-text">
            <h3>In your own calendar</h3>
            <p>
              Add a visit to Google Calendar, Outlook or your phone's calendar
              in one tap.
            </p>
          </div>
        </Reveal>

        <Reveal className="tile tile-move" index={2}>
          <span className="move-art" aria-hidden="true">
            <span className="move-slot from">Thu · 10:15</span>
            <span className="move-turn">
              <Repeat size={18} />
            </span>
            <span className="move-slot to">Fri · 14:00</span>
          </span>
          <div className="tile-text">
            <h3>Move, cancel or book again</h3>
            <p>
              Move or cancel a visit without calling the hospital, and book the
              same clinician again from your history.
            </p>
          </div>
        </Reveal>

        <Reveal className="tile tile-change" index={3}>
          <span className="change-art" aria-hidden="true">
            <span className="change-toast">
              <span className="change-toast-icon">
                <Clock size={16} />
              </span>
              <span>
                <b>Your clinician is unavailable on Thursday</b>
                <small>Choose one of the nearest new times</small>
              </span>
            </span>
            <span className="change-times">
              {["Thu · 15:30", "Fri · 09:00", "Fri · 11:20"].map((t, i) => (
                <span key={t} style={{ "--i": i } as CSSProperties}>
                  {t}
                </span>
              ))}
            </span>
          </span>
          <div className="tile-text">
            <h3>When plans change on our side</h3>
            <p>
              If your clinician becomes unavailable you are told at once and
              offered the nearest new times; nothing is moved without you.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ privacy */

function Privacy() {
  return (
    <section className="privacy" aria-labelledby="privacy-title">
      <div className="privacy-art">
        <span className="privacy-ring" aria-hidden="true" />
        <span className="privacy-vault" aria-hidden="true">
          <span className="privacy-vault-shape" />
          <Lock size={96} />
        </span>
        <Reveal className="privacy-chip chip-a">
          <Lock size={15} /> Only you and your clinician
        </Reveal>
        <Reveal className="privacy-chip chip-b" index={2}>
          <Clock size={15} /> Deleted 90 days after the visit
        </Reveal>
      </div>
      <div className="privacy-copy">
        <p className="more-eyebrow on-dark">YOUR DATA</p>
        <h2 id="privacy-title" className="big-title on-dark">
          <Rise text="Who sees what, in plain words." />
        </h2>
        <ul className="privacy-list">
          {PRIVACY.map(({ icon: Icon, title, body }, i) => (
            <Reveal as="li" key={title} index={i} className="privacy-item">
              <span className="privacy-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span>
                <h3>{title}</h3>
                <p>{body}</p>
              </span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ questions */

function Questions() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="more-section faq" aria-labelledby="faq-title">
      <div className="faq-head">
        <p className="more-eyebrow">QUESTIONS</p>
        <h2 id="faq-title" className="big-title">
          <Rise text="What people ask first." />
        </h2>
        <p className="more-lede">
          Anything else, the front desk at {TENANT.name} can help with.
        </p>
      </div>
      <div className="faq-list">
        {QUESTIONS.map(({ q, a }, i) => (
          <Reveal
            key={q}
            index={i}
            className={`faq-item ${open === i ? "open" : ""}`}
          >
            <button
              type="button"
              className="faq-q"
              aria-expanded={open === i}
              aria-controls={`faq-${i}`}
              onClick={() => setOpen(open === i ? null : i)}
            >
              {q}
              <span className="faq-toggle" aria-hidden="true" />
            </button>
            <div className="faq-a" id={`faq-${i}`} role="region">
              <p>{a}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function LandingMore() {
  return (
    <div className="landing-more">
      <WaysStage />
      <Story />
      <Marquee />
      <Bento />
      <Privacy />

      <section className="more-section" aria-labelledby="staff-title">
        <Reveal className="staff-band">
          <span className="staff-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="staff-icon" aria-hidden="true">
            <Building size={24} />
          </span>
          <span className="staff-text">
            <h2 id="staff-title">Working at {TENANT.name}?</h2>
            <p>
              The front desk, clinicians and unit managers use the same
              calendar: today's list, the week, the queue, the patient register,
              hours and leave, and the unit's messages.
            </p>
          </span>
          <Link className="staff-link" to="/staff/sign-in">
            Go to the staff console <ArrowUpRight size={16} />
          </Link>
        </Reveal>
      </section>

      <Questions />

      <section className="end" aria-labelledby="end-title">
        <span className="end-blob end-blob-a" aria-hidden="true" />
        <span className="end-blob end-blob-b" aria-hidden="true" />
        <h2 id="end-title" className="end-title">
          <Rise text="Ready when you are." />
        </h2>
        <p>One account works on your laptop, tablet and phone.</p>
        <div className="end-cta">
          <Link className="end-create" to="/create-account">
            Create an account
          </Link>
          <Link className="end-have" to="/sign-in">
            Sign in <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="more-footer">
        <span className="landing-logo">
          <span className="logo-mark">
            <Pulse size={19} />
          </span>
          <span className="landing-wordmark">ATRIA</span>
        </span>
        <span>
          {TENANT.name} · {TENANT.place}
        </span>
        <span className="more-footer-links">
          <Globe size={14} /> English
        </span>
      </footer>
    </div>
  );
}
