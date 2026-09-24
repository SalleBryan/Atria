import { fitFor, MIN_FIT } from "./fit";

describe("fitFor", () => {
  it("draws the frame at its own size when the window is big enough", () => {
    expect(fitFor(1440, 900)).toBe(1);
    expect(fitFor(1440, 760)).toBe(1);
    expect(fitFor(1920, 1080)).toBe(1);
  });

  it("follows the height on a short laptop window", () => {
    // 1920 x 1080 at 150% display scaling, less the browser's own bars.
    expect(fitFor(1280, 550)).toBeCloseTo(550 / 760);
  });

  it("follows the width when the window is narrow rather than short", () => {
    expect(fitFor(1000, 900)).toBeCloseTo(1000 / 1240);
    expect(fitFor(1100, 760)).toBeCloseTo(1100 / 1240);
  });

  it("never zooms out past the legibility floor", () => {
    expect(fitFor(1280, 400)).toBe(MIN_FIT);
  });

  it("leaves phones and small tablets to their own layout", () => {
    expect(fitFor(375, 812)).toBe(1);
    expect(fitFor(959, 500)).toBe(1);
  });
});
