import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { App } from "./App";
import { SessionContext } from "./auth/session";

// Stand-ins for the dashboards, so a redirect has somewhere to land. Built
// with createElement, since a hoisted mock runs before JSX's runtime loads.
vi.mock("./patient/routes", async () => {
  const { createElement } = await import("react");
  const { Route } = await import("react-router-dom");
  return { patientRoutes: createElement(Route, { path: "/home", element: "home" }) };
});
vi.mock("./staff/routes", async () => {
  const { createElement } = await import("react");
  const { Route } = await import("react-router-dom");
  return { staffRoutes: createElement(Route, { path: "/console", element: "console" }) };
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string, state: unknown) {
  const session = { state, refresh: vi.fn(), signOut: vi.fn() };
  render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("the sign-in pages", () => {
  it.each([
    ["/sign-in", "patient", "/home"],
    ["/create-account", "patient", "/home"],
    ["/staff/sign-in", "staff", "/console"],
    ["/reset-password", "staff", "/console"],
  ])("send someone already signed in from %s to their dashboard", (path, audience, landing) => {
    renderAt(path, { status: "signed-in", me: { roles: [] }, audience });
    expect(screen.getByTestId("where")).toHaveTextContent(landing);
  });

  it("show the front page to someone signed out", () => {
    renderAt("/", { status: "signed-out" });
    expect(screen.getByRole("heading", { name: "Care that keeps time with you." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Staff sign-in" })).toHaveAttribute("href", "/staff/sign-in");
  });
});
