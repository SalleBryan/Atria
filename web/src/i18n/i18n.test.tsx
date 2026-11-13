import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { LanguageProvider } from "./LanguageProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({ ...(await original<typeof import("../api/client")>()), api }));

function show(me: Me | null) {
  const state = me ? { status: "signed-in" as const, me, audience: "patient" as const } : { status: "signed-out" as const };
  const session = { state, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <LanguageProvider>
        <LanguageSwitcher />
      </LanguageProvider>
    </SessionContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  api.mockReset();
  api.mockResolvedValue({});
});

describe("NFR-L10N-01 language choice", () => {
  it("changes the rendered text at once and saves it with PATCH /me", async () => {
    show({ personId: "p" } as Me);
    await userEvent.click(screen.getByRole("button", { name: "Language" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Français" }));
    expect(await screen.findByRole("button", { name: "Langue" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
    expect(api).toHaveBeenCalledWith("/me", { method: "PATCH", json: { preferredLanguage: "fr" } });
  });

  it("keeps a signed-out choice in this browser across a reload, without calling the API", async () => {
    const first = show(null);
    await userEvent.click(screen.getByRole("button", { name: "Language" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Pidgin" }));
    expect(localStorage.getItem("atria.language")).toBe("pcm");
    expect(api).not.toHaveBeenCalled();
    first.unmount();
    show(null);
    expect(document.documentElement.lang).toBe("pcm");
  });

  it("prefers the account's saved language over the browser's", () => {
    localStorage.setItem("atria.language", "fr");
    show({ personId: "p", preferredLanguage: "pcm" } as Me);
    expect(document.documentElement.lang).toBe("pcm");
  });

  it("falls back to English for an unknown stored value", async () => {
    localStorage.setItem("atria.language", "xx");
    show(null);
    expect(await screen.findByRole("button", { name: "Language" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });
});
