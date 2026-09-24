/**
 * The development preview: the real patient app, signed in as an invented
 * patient, against the stand-in API (mockApi.ts).
 *
 *     http://localhost:5173/__preview           Home
 *     http://localhost:5173/__preview?at=/visits another screen
 *
 * It exists so screens can be looked at and clicked through without anyone
 * signing in with a real password. main.tsx loads it only on the dev server
 * (import.meta.env.DEV), so it is never part of a production build.
 */

import { useMemo } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { patientRoutes } from "../patient/routes";

const ME: Me = {
  personId: "p-preview",
  givenName: "Amina",
  familyName: "Ngo",
  tenantId: "t-cm-001",
  roles: ["PATIENT"],
  patientProfileId: "pp-preview",
  staffId: null,
  clinicId: null,
  phoneVerified: true,
  languages: ["fr", "en"],
  permissions: {},
  landing: ["Upcoming visits"],
};

export default function Preview() {
  const start = new URLSearchParams(window.location.search).get("at") ?? "/home";
  const session = useMemo(
    () => ({
      state: { status: "signed-in" as const, me: ME, audience: "patient" as const },
      refresh: async () => ({ status: "signed-in" as const, me: ME, audience: "patient" as const }),
      signOut: async () => {
        window.location.assign("/__preview");
      },
    }),
    [],
  );
  return (
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          {patientRoutes}
          <Route path="*" element={<p style={{ padding: 24 }}>The preview has no screen at this address.</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>
  );
}
