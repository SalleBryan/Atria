import { brandEnters, enterFrom, remember, tabFrom } from "./memory";

describe("how a screen arrives", () => {
  beforeEach(() => remember.reset());

  it("rises on a fresh visit", () => {
    expect(enterFrom("/sign-in")).toBe("rise");
  });

  it("slides along the Sign in / Create account axis", () => {
    remember.screen("/sign-in", "patient");
    expect(enterFrom("/create-account")).toBe("forward");
    remember.screen("/create-account", "patient");
    expect(enterFrom("/sign-in")).toBe("back");
  });

  it("rises when either end is off the axis", () => {
    remember.screen("/sign-in", "patient");
    expect(enterFrom("/verify-email")).toBe("rise");
    remember.screen("/verify-email", "verify");
    expect(enterFrom("/sign-in")).toBe("rise");
  });

  it("replays the brand pane only when what it shows changes", () => {
    expect(brandEnters("patient")).toBe(true);
    remember.screen("/sign-in", "patient");
    expect(brandEnters("patient")).toBe(false);
    expect(brandEnters("verify")).toBe(true);
  });

  it("starts the segmented pill where the last screen left it", () => {
    expect(tabFrom(1)).toBe(1);
    remember.tab(0);
    expect(tabFrom(1)).toBe(0);
  });
});
