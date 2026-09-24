import { easing, EXPRESSIVE, position, settleTime, type Spring } from "./springs";

function peak(spring: Spring): number {
  let highest = 0;
  for (let t = 0; t < 2; t += 0.0005) highest = Math.max(highest, position(spring, t));
  return highest;
}

/** The textbook overshoot of an underdamped spring. */
const overshoot = (zeta: number) => Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));

describe("Material 3 Expressive springs", () => {
  it("start at rest and end at rest", () => {
    for (const family of Object.values(EXPRESSIVE)) {
      for (const spring of Object.values(family)) {
        expect(position(spring, 0)).toBeCloseTo(0, 6);
        expect(position(spring, settleTime(spring))).toBeCloseTo(1, 2);
      }
    }
  });

  it("never overshoot on effects: colour and opacity do not bounce", () => {
    for (const spring of Object.values(EXPRESSIVE.effects)) {
      expect(peak(spring)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("bounce on spatial movement, most on the fast spring", () => {
    expect(peak(EXPRESSIVE.spatial.fast) - 1).toBeCloseTo(overshoot(0.6), 2); // about 9.5%
    expect(peak(EXPRESSIVE.spatial.default) - 1).toBeCloseTo(overshoot(0.8), 2); // about 1.5%
  });

  it("settle sooner the stiffer they are", () => {
    for (const family of Object.values(EXPRESSIVE)) {
      expect(settleTime(family.fast)).toBeLessThan(settleTime(family.default));
      expect(settleTime(family.default)).toBeLessThan(settleTime(family.slow));
    }
  });

  it("take durations that read as quick, not sluggish", () => {
    expect(settleTime(EXPRESSIVE.effects.fast)).toBeLessThan(0.25);
    expect(settleTime(EXPRESSIVE.spatial.slow)).toBeLessThan(0.9);
  });

  it("are written as a CSS linear() easing that ends exactly at rest", () => {
    const { linear, durationMs } = easing(EXPRESSIVE.spatial.fast);
    expect(linear.startsWith("linear(0, ")).toBe(true);
    expect(linear.endsWith(", 1)")).toBe(true);
    const values = linear.slice(7, -1).split(", ").map(Number);
    expect(Math.max(...values)).toBeGreaterThan(1.05); // the overshoot survives sampling
    expect(durationMs).toBeGreaterThan(200);
  });
});
