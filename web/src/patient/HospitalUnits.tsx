/**
 * The hospital's units on a map of the site (2026-09-28). Units share the
 * hospital's street address, so directions to the address leave a patient at
 * the gate; each unit the hospital has placed carries its entrance, and the
 * map draws them relative to one another. Choosing a unit, from the list or
 * its pin, shows where it is inside and its hours; directions lead to the
 * hospital, since maps apps know it and not its units.
 *
 * The map is a drawing of the placed entrances, not a live map: no tiles, no
 * third-party script, nothing sent anywhere until the patient asks for
 * directions.
 */

import { useRef, useState } from "react";

import { Pager, usePages, useRowsThatFit } from "../components/Pager";
import { ChevronRight, Pin } from "../components/icons";
import { type Clinic, directionsTo, entranceOf, hoursOn, whereInside } from "./data";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAP = { width: 400, height: 220, pad: 28 };

export function HospitalUnits({ clinics, hospital }: { clinics: Clinic[]; hospital: string }) {
  const [chosenId, setChosenId] = useState<string | null>(clinics[0]?.clinicId ?? null);
  const chosen = clinics.find((c) => c.clinicId === chosenId) ?? clinics[0];
  const rowsBox = useRef<HTMLUListElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const size = useRowsThatFit(rowsBox, { row: ".unit-row", pitch: 62, gap: 8 });
  const pages = usePages(clinics, size, "units");

  function choose(clinicId: string) {
    setChosenId(clinicId);
    pages.reveal(clinics.findIndex((c) => c.clinicId === clinicId));
  }

  return (
    <div className="hospital-units">
      <div className="inner-card settings-card unit-list">
        <ul ref={rowsBox} className="unit-rows" aria-label="Units">
          {pages.shown.map((clinic) => {
            const today = hoursOn(clinic);
            const active = clinic.clinicId === chosen?.clinicId;
            return (
              <li key={clinic.clinicId}>
                <button
                  type="button"
                  className={`unit-row${active ? " active" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    choose(clinic.clinicId);
                    // On a phone the map sits above the list: bring it back into view.
                    if (side.current && side.current.getBoundingClientRect().top < 0) {
                      side.current.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  <span className="unit-row-text">
                    <span className="unit-row-name">{clinic.name}</span>
                    <span className="unit-row-sub">
                      {[whereInside(clinic), today ? `open ${today.start} to ${today.end}` : "closed today"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </li>
            );
          })}
        </ul>
        <Pager
          first={pages.first}
          last={pages.last}
          total={pages.total}
          page={pages.page}
          pages={pages.pages}
          onPrevious={pages.previous}
          onNext={pages.next}
          noun="units"
        />
      </div>

      <div ref={side} className="unit-side">
        <SiteMap clinics={clinics} chosenId={chosen?.clinicId ?? null} onChoose={choose} hospital={hospital} />
        {chosen && <UnitDetail clinic={chosen} />}
      </div>
    </div>
  );
}

function SiteMap({
  clinics,
  chosenId,
  onChoose,
  hospital,
}: {
  clinics: Clinic[];
  chosenId: string | null;
  onChoose: (clinicId: string) => void;
  hospital: string;
}) {
  const placed = clinics.flatMap((clinic) => {
    const door = entranceOf(clinic);
    return door ? [{ clinic, door }] : [];
  });
  if (!placed.length) {
    return (
      <div className="inner-card site-map site-map-empty">
        <Pin size={20} />
        <p>{hospital} has not placed its units on the map yet. Directions lead to the hospital, and the front desk can show you the way.</p>
      </div>
    );
  }
  const lats = placed.map((p) => p.door.lat);
  const lngs = placed.map((p) => p.door.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // One scale for both axes, so the site keeps its shape.
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.0004);
  const scale = Math.min(MAP.width - 2 * MAP.pad, MAP.height - 2 * MAP.pad) / span;
  const offsetX = (MAP.width - (maxLng - minLng) * scale) / 2;
  const offsetY = (MAP.height - (maxLat - minLat) * scale) / 2;
  const at = (door: { lat: number; lng: number }) => ({
    x: offsetX + (door.lng - minLng) * scale,
    y: MAP.height - (offsetY + (door.lat - minLat) * scale),
  });
  const chosen = placed.find((p) => p.clinic.clinicId === chosenId);

  return (
    <div className="inner-card site-map">
      <svg viewBox={`0 0 ${MAP.width} ${MAP.height}`} role="group" aria-label={`Map of ${hospital}`}>
        <rect width={MAP.width} height={MAP.height} className="map-ground" />
        <rect x={10} y={10} width={MAP.width - 20} height={MAP.height - 20} rx={18} className="site-grounds" />
        <path className="map-road map-road-thin" d={`M0 ${MAP.height - 16} H${MAP.width} M${MAP.width / 2} ${MAP.height} V${MAP.height - 16}`} />
        {chosen && (
          <path
            key={chosen.clinic.clinicId}
            className="map-route"
            pathLength={1}
            d={`M${MAP.width / 2} ${MAP.height - 16} V${at(chosen.door).y} H${at(chosen.door).x}`}
          />
        )}
        {placed.map(({ clinic, door }) => {
          const { x, y } = at(door);
          const active = clinic.clinicId === chosenId;
          return (
            <g
              key={clinic.clinicId}
              className={`site-pin${active ? " active" : ""}`}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${clinic.name}${active ? ", shown" : ""}`}
              onClick={() => onChoose(clinic.clinicId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChoose(clinic.clinicId);
                }
              }}
            >
              <circle r={active ? 11 : 7} />
              {active && <circle r={4} className="site-pin-dot" />}
            </g>
          );
        })}
        {chosen && <SiteTag name={chosen.clinic.name} {...at(chosen.door)} />}
        <g className="site-gate" transform={`translate(${MAP.width / 2} ${MAP.height - 16})`}>
          <rect x={-22} y={-9} width={44} height={18} rx={9} />
          <text y={3.5}>Gate</text>
        </g>
      </svg>
      {placed.length < clinics.length && (
        <p className="site-map-note">
          {clinics.length - placed.length} of {clinics.length} units are not on the map yet.
        </p>
      )}
    </div>
  );
}

/** The chosen unit's name beside its pin, kept inside the drawing. */
function SiteTag({ name, x, y }: { name: string; x: number; y: number }) {
  const label = name.length > 30 ? `${name.slice(0, 29)}…` : name;
  const width = label.length * 6.1 + 20;
  const left = Math.min(Math.max(x - width / 2, 8), MAP.width - width - 8);
  const top = y - 42 < 6 ? y + 16 : y - 42;
  return (
    <g className="site-tag" transform={`translate(${left} ${top})`} aria-hidden="true">
      <rect width={width} height={24} rx={12} />
      <text x={10} y={16}>
        {label}
      </text>
    </g>
  );
}

function UnitDetail({ clinic }: { clinic: Clinic }) {
  const where = whereInside(clinic);
  return (
    <div className="inner-card settings-card unit-detail" aria-live="polite">
      <div className="unit-detail-head">
        <span>
          <span className="clinician-name">{clinic.name}</span>
          <span className="who-sub">{[where, clinic.address].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      {clinic.location?.directions && <p className="unit-detail-way">{clinic.location.directions}</p>}
      <dl className="hours">
        {WEEKDAYS.map((day, i) => {
          const hours = clinic.openingHours?.[String(i)];
          return (
            <div key={day}>
              <dt>{day}</dt>
              <dd>{hours ? `${hours.start} to ${hours.end}` : "Closed"}</dd>
            </div>
          );
        })}
      </dl>
      <a className="dock-button unit-directions" href={directionsTo(clinic)} target="_blank" rel="noreferrer">
        <Pin size={18} />
        Directions to the hospital
      </a>
    </div>
  );
}
