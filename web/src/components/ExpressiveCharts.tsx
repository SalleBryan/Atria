/**
 * Material 3 Expressive Charts (Admin Overview & Reports).
 *
 * Provides:
 * 1. DonutChart: Generous interactive SVG donut chart with animated segments,
 *    centered KPI readout, and responsive breakdown cards.
 * 2. MultiUnitBarChart: Compact vertical column bar chart modeled after the
 *    overview delivery chart, saving vertical space while comparing all units.
 */

import { type CSSProperties, useState } from "react";

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
  secondaryColor?: string;
}

export interface DonutChartProps {
  title?: string;
  subtitle?: string;
  segments: DonutSegment[];
  totalLabel?: string;
  centerValue?: string;
  centerSub?: string;
  size?: number;
  ariaLabel?: string;
  className?: string;
}

export function DonutChart({ title, subtitle, segments, centerValue, centerSub, size = 230, ariaLabel, className = "" }: DonutChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const activeSegment = segments.find((s) => s.id === hoveredId);

  // SVG Geometry - spacious 220x220 canvas
  const radius = 78;
  const strokeWidth = 22;
  const center = 110;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  const displayCenterValue = activeSegment ? String(activeSegment.value) : (centerValue ?? String(total));

  const displayCenterSub = activeSegment ? activeSegment.label : (centerSub ?? "Total");

  const displayCenterPct = activeSegment && total > 0 ? `${Math.round((activeSegment.value / total) * 100)}%` : null;

  return (
    <div className={`m3-expressive-chart-wrap ${className}`} aria-label={ariaLabel}>
      {(title || subtitle) && (
        <div className="m3-chart-header">
          {title && <h3>{title}</h3>}
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}

      <div className="m3-donut-layout">
        <div
          className="m3-donut-svg-wrap"
          style={{ width: size, height: size, maxWidth: "100%", maxHeight: size }}
          role="img"
          aria-label={ariaLabel || "Visual donut distribution"}
        >
          <svg viewBox="0 0 220 220" className="m3-donut-svg" onMouseLeave={() => setHoveredId(null)}>
            {/* Background Track */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke="var(--surface-field, #edf2fb)"
              strokeWidth={strokeWidth}
            />

            {/* Segments */}
            {total > 0 &&
              segments.map((seg) => {
                const fraction = Math.max(0, seg.value) / total;
                const dashLength = fraction * circumference;
                const strokeDasharray = `${dashLength} ${circumference - dashLength}`;
                const strokeDashoffset = -currentOffset;
                currentOffset += dashLength;

                const isHovered = hoveredId === seg.id;
                const isAnyHovered = hoveredId !== null;

                return (
                  <circle
                    key={seg.id}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="m3-donut-slice"
                    style={{
                      cursor: "pointer",
                      transformOrigin: "center",
                      transform: "rotate(-90deg)",
                      transition: "stroke-width 220ms ease, opacity 200ms ease, filter 200ms ease",
                      opacity: isAnyHovered && !isHovered ? 0.45 : 1,
                      filter: isHovered ? "drop-shadow(0 4px 10px rgba(0, 0, 0, 0.18))" : "none",
                    }}
                    onMouseEnter={() => setHoveredId(seg.id)}
                  />
                );
              })}
          </svg>

          {/* Center Callout */}
          <div className="m3-donut-center" aria-hidden="true">
            <span className="m3-donut-center-val">{displayCenterValue}</span>
            <span className="m3-donut-center-sub">{displayCenterSub}</span>
            {displayCenterPct && <span className="m3-donut-center-pct">{displayCenterPct}</span>}
          </div>
        </div>

        {/* Legend Cards */}
        <div className="m3-donut-legend">
          {segments.map((seg) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
            const isHovered = hoveredId === seg.id;

            return (
              <div
                key={seg.id}
                className={`m3-legend-card ${isHovered ? "hovered" : ""}`}
                onMouseEnter={() => setHoveredId(seg.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="m3-legend-left">
                  <span className="m3-legend-dot" style={{ backgroundColor: seg.color }} />
                  <span className="m3-legend-label">{seg.label}</span>
                </div>
                <div className="m3-legend-right">
                  <strong className="m3-legend-val">{seg.value}</strong>
                  <span className="m3-legend-pct">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface UnitBarData {
  unitId: string;
  name: string;
  attended: number;
  noShow: number;
  cancelled: number;
  total: number;
  rate?: number | null;
}

export interface MultiUnitBarChartProps {
  title?: string;
  subtitle?: string;
  units: UnitBarData[];
  onSelectUnit?: (unitId: string) => void;
  className?: string;
}

function shortUnit(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("outpatient")) return "GOPD";
  if (n.includes("medical")) return "Medical";
  if (n.includes("paediatric")) return "Paed";
  if (n.includes("surgical")) return "Surg";
  if (n.includes("dental")) return "Dental";
  if (n.includes("diabetes")) return "Diab";
  if (n.includes("eye")) return "Eye";
  if (n.includes("haemodialysis")) return "Haemo";
  if (n.includes("hiv")) return "HIV";
  if (n.includes("maternity")) return "Mat";
  if (n.includes("tuberculosis")) return "TB";
  return name.replace(/\s+Unit|\s+Centre|\s+Department/gi, "").slice(0, 7);
}

export function MultiUnitBarChart({ title, subtitle, units, onSelectUnit, className = "" }: MultiUnitBarChartProps) {
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const maxTotal = Math.max(1, ...units.map((u) => u.total));
  const activeUnit = units.find((u) => u.unitId === hoveredUnitId);

  return (
    <figure className={`m3-expressive-chart-wrap m3-unit-columns-wrap ${className}`}>
      {(title || subtitle) && (
        <div className="m3-chart-header">
          {title && <h3>{title}</h3>}
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}

      {/* Interactive Detail Header Strip */}
      <div className="m3-column-inspect-bar" aria-live="polite">
        {activeUnit ? (
          <span className="m3-column-inspect-active">
            <strong>{activeUnit.name}</strong>: {activeUnit.total} {activeUnit.total === 1 ? "visit" : "visits"} · {activeUnit.attended}{" "}
            attended, {activeUnit.noShow} no-show, {activeUnit.cancelled} cancelled
            {activeUnit.rate != null && <span> ({Math.round(activeUnit.rate * 100)}% attendance)</span>}
          </span>
        ) : (
          <span className="m3-column-inspect-idle">Hover over any hospital unit column below to inspect operational volume</span>
        )}
      </div>

      <div className="m3-column-scroll-area">
        <div className="m3-column-plot" role="img" aria-label={title || "Unit comparative volume"}>
          {units.map((u, i) => {
            const colHeight = u.total > 0 ? Math.max(10, Math.round((u.total / maxTotal) * 100)) : 4;
            const isHovered = hoveredUnitId === u.unitId;
            const hasVisits = u.total > 0;
            const attendedPct = hasVisits ? (u.attended / u.total) * 100 : 0;
            const noShowPct = hasVisits ? (u.noShow / u.total) * 100 : 0;
            const cancelledPct = hasVisits ? (u.cancelled / u.total) * 100 : 0;

            return (
              <div
                key={u.unitId}
                className={`m3-column-bar ${isHovered ? "hovered" : ""}`}
                style={{ "--i": i } as CSSProperties}
                onMouseEnter={() => setHoveredUnitId(u.unitId)}
                onMouseLeave={() => setHoveredUnitId(null)}
                onClick={() => onSelectUnit?.(u.unitId)}
                role="button"
                tabIndex={0}
                aria-label={`${u.name}: ${u.total} visits`}
              >
                <div className="m3-column-stack" style={{ height: `${colHeight}%` }}>
                  {cancelledPct > 0 && <span className="m3-col-seg cancelled" style={{ height: `${cancelledPct}%` }} />}
                  {noShowPct > 0 && <span className="m3-col-seg noshow" style={{ height: `${noShowPct}%` }} />}
                  {attendedPct > 0 && <span className="m3-col-seg attended" style={{ height: `${attendedPct}%` }} />}
                  {!hasVisits && <span className="m3-col-seg empty" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="m3-column-x" aria-hidden="true">
          {units.map((u) => (
            <span
              key={u.unitId}
              className={hoveredUnitId === u.unitId ? "active" : ""}
              title={u.name}
              onClick={() => onSelectUnit?.(u.unitId)}
            >
              {shortUnit(u.name)}
            </span>
          ))}
        </div>
      </div>

      <figcaption className="overview-legend m3-bars-legend">
        <span>
          <i style={{ backgroundColor: "#10b981" }} /> Attended
        </span>
        <span>
          <i style={{ backgroundColor: "#f43f5e" }} /> No-show
        </span>
        <span>
          <i style={{ backgroundColor: "#f59e0b" }} /> Cancelled
        </span>
        {onSelectUnit && <span className="overview-legend-note">Click a unit to focus its report</span>}
      </figcaption>
    </figure>
  );
}
