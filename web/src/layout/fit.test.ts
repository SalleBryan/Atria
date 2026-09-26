import { fitFor, MAX_FIT, MIN_FIT, tallness, tierFor } from "./fit";

describe("tierFor", () => {
  it("gives each width its Rev A frame set", () => {
    expect(tierFor(375)).toBe("mobile");
    expect(tierFor(767)).toBe("mobile");
    expect(tierFor(768)).toBe("tablet");
    expect(tierFor(1194)).toBe("tablet");
    expect(tierFor(1200)).toBe("desktop");
  });
});

describe("fitFor", () => {
  it("zooms by the width alone, so the canvas is always the frame's width", () => {
    expect(fitFor(1440)).toBe(1);
    // A 1920 x 1080 screen at 150%: a normal window and full screen are both 1280 wide.
    expect(fitFor(1280)).toBeCloseTo(1280 / 1440);
    expect(fitFor(1920)).toBeCloseTo(1920 / 1440);
  });

  it("fits a tablet window to the tablet frame's width", () => {
    expect(fitFor(1194)).toBe(1);
    expect(fitFor(1024)).toBeCloseTo(1024 / 1194);
  });

  it("stops growing before type turns into a billboard", () => {
    expect(fitFor(3840)).toBe(MAX_FIT);
  });

  it("never shrinks past the legibility floor", () => {
    expect(MIN_FIT).toBeLessThanOrEqual(768 / 1194);
  });

  it("leaves phones unzoomed", () => {
    expect(fitFor(375)).toBe(1);
    expect(fitFor(767)).toBe(1);
  });
});

describe("tallness", () => {
  it("runs from 0 on the safe area to 1 on the frame's own height", () => {
    expect(tallness(760)).toBe(0);
    expect(tallness(830)).toBeCloseTo(0.5);
    expect(tallness(900)).toBe(1);
    expect(tallness(1200)).toBe(1);
  });
});
