/** Render a screen inside a router, with a probe that reports where it navigated. */

import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

export function Probe() {
  const location = useLocation();
  return (
    <p data-testid="landed">
      {location.pathname} {JSON.stringify(location.state ?? null)}
    </p>
  );
}

export function renderAt(path: string, element: ReactElement, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** An error shaped like the ones Amplify throws: the Cognito name on .name. */
export function cognitoError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
