/**
 * The development preview: the real patient app and staff console, signed in
 * as an invented person, against the stand-in API (mockApi.ts).
 *
 *     http://localhost:5173/__preview                       patient, Home
 *     http://localhost:5173/__preview?at=/visits            patient, another screen
 *     http://localhost:5173/__preview?as=receptionist       the console, as the front desk
 *     http://localhost:5173/__preview?as=clinician          a clinician's own calendar
 *     http://localhost:5173/__preview?as=manager            a clinic manager
 *     http://localhost:5173/__preview?as=admin              a tenant administrator
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
import { staffRoutes } from "../staff/routes";

const BASE = {
  tenantId: "t-cm-001",
  phoneE164: "+12025550142",
  phoneVerified: true,
  permissions: {},
  landing: [],
};

const PEOPLE: Record<string, Me> = {
  patient: {
    ...BASE,
    personId: "p-preview",
    givenName: "Amina",
    familyName: "Ngo",
    email: "amina.ngo@example.com",
    roles: ["PATIENT"],
    patientProfileId: "pp-preview",
    staffId: null,
    clinicId: null,
    languages: ["fr", "en"],
    landing: ["Upcoming visits"],
  },
  receptionist: {
    ...BASE,
    personId: "p-desk",
    givenName: "Nadine",
    familyName: "Fotso",
    email: "n.fotso@example.com",
    roles: ["RECEPTIONIST"],
    patientProfileId: null,
    staffId: "s-desk",
    clinicId: "c-douala-akwa",
    languages: ["fr", "en"],
  },
  clinician: {
    ...BASE,
    personId: "p-mbarga",
    givenName: "Esther",
    familyName: "Mbarga",
    email: "e.mbarga@example.com",
    roles: ["CLINICIAN"],
    patientProfileId: null,
    staffId: "s-mbarga",
    clinicId: "c-douala-akwa",
    languages: ["fr", "en"],
  },
  manager: {
    ...BASE,
    personId: "p-manager",
    givenName: "Rodrigue",
    familyName: "Owona",
    email: "r.owona@example.com",
    roles: ["CLINIC_MANAGER"],
    patientProfileId: null,
    staffId: "s-manager",
    clinicId: "c-douala-akwa",
    languages: ["fr"],
  },
  admin: {
    ...BASE,
    personId: "p-admin",
    givenName: "Sandrine",
    familyName: "Eyenga",
    email: "s.eyenga@example.com",
    roles: ["TENANT_ADMIN"],
    patientProfileId: null,
    staffId: "s-admin",
    clinicId: null,
    languages: ["fr", "en"],
  },
};

export default function Preview() {
  const query = new URLSearchParams(window.location.search);
  const as = query.get("as") ?? "patient";
  const me = PEOPLE[as] ?? PEOPLE.patient!;
  const audience = me.roles.includes("PATIENT") ? ("patient" as const) : ("staff" as const);
  const start = query.get("at") ?? (audience === "staff" ? "/console" : "/home");
  const session = useMemo(
    () => ({
      state: { status: "signed-in" as const, me, audience },
      refresh: async () => ({ status: "signed-in" as const, me, audience }),
      signOut: async () => {
        window.location.assign("/__preview");
      },
    }),
    [me, audience],
  );
  return (
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          {patientRoutes}
          {staffRoutes}
          <Route path="*" element={<p style={{ padding: 24 }}>The preview has no screen at this address.</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>
  );
}
