import { fitFor, MIN_FIT, tierFor } from "./fit";

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
  it("draws the desktop frame at its own size when the window is big enough", () => {
    expect(fitFor(1440, 900)).toBe(1);
    expect(fitFor(1920, 1080)).toBe(1);
  });

  it("follows the height on a short laptop window", () => {
    expect(fitFor(1280, 550)).toBeCloseTo(550 / 760);
  });

  it("follows the width when a desktop window is narrow rather than short", () => {
    expect(fitFor(1220, 900)).toBeCloseTo(1220 / 1240);
  });

  it("fits a tablet window to the tablet frame", () => {
    expect(fitFor(1194, 834)).toBe(1);
    expect(fitFor(1024, 768)).toBeCloseTo(Math.min(768 / 834, 1024 / 1194));
  });

  it("never zooms out past the legibility floor", () => {
    expect(fitFor(1280, 400)).toBe(MIN_FIT);
  });

  it("leaves phones unzoomed", () => {
    expect(fitFor(375, 812)).toBe(1);
    expect(fitFor(767, 500)).toBe(1);
  });
});
