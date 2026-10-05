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
 *     http://localhost:5173/__preview?as=admin-new          one yet to set up an authenticator
 *     http://localhost:5173/__preview?as=patient-google     a Google sign-up yet to finish their record
 *     http://localhost:5173/__preview?as=patient-deleted    one who deleted their account and came back
 *
 * It exists so screens can be looked at and clicked through without anyone
 * signing in with a real password. main.tsx loads it only on the dev server
 * (import.meta.env.DEV), so it is never part of a production build.
 */

import { useEffect, useMemo, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { patientRoutes } from "../patient/routes";
import { staffRoutes } from "../staff/routes";
import { setPreviewCaller } from "./mockApi";

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
  // The outpatient department's desk and one of its doctors, who run the queue.
  opd: {
    ...BASE,
    personId: "p-ngassa",
    givenName: "Kofi",
    familyName: "Ngassa",
    email: null,
    roles: ["RECEPTIONIST"],
    patientProfileId: null,
    staffId: "s-ngassa",
    clinicId: "u-rhb-opd",
    languages: ["en"],
  },
  gp: {
    ...BASE,
    personId: "p-mbua",
    givenName: "Walters",
    familyName: "Mbua",
    email: null,
    roles: ["CLINICIAN"],
    patientProfileId: null,
    staffId: "s-mbua",
    clinicId: "u-rhb-opd",
    languages: ["en"],
  },
  surgeon: {
    ...BASE,
    personId: "p-ekane",
    givenName: "Emmanuel",
    familyName: "Ekane",
    email: null,
    roles: ["CLINICIAN"],
    patientProfileId: null,
    staffId: "s-ekane",
    clinicId: "u-rhb-surgery",
    languages: ["en"],
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
    clinicId: "u-rhb-medicine",
    languages: ["fr", "en"],
  },
  clinician: {
    ...BASE,
    personId: "p-nkoulou",
    givenName: "Jean-Paul",
    familyName: "Nkoulou",
    email: "j.nkoulou@example.com",
    roles: ["CLINICIAN"],
    patientProfileId: null,
    staffId: "s-nkoulou",
    clinicId: "u-rhb-medicine",
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
    clinicId: "u-rhb-medicine",
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
// FR-ACC-11: the console asks for an authenticator before anything else.
PEOPLE["admin-new"] = { ...PEOPLE.admin!, secondFactorRequired: true };
PEOPLE["patient-deleted"] = {
  ...PEOPLE.patient!,
  deletion: { purgeAt: new Date(Date.now() + 23 * 86400000).toISOString(), requestedAt: new Date(Date.now() - 7 * 86400000).toISOString(), by: "SELF", graceDays: 30 },
};
PEOPLE["patient-google"] = { ...PEOPLE.patient!, phoneE164: null, phoneVerified: false, missing: ["phone", "dateOfBirth", "terms"] };

export default function Preview() {
  const query = new URLSearchParams(window.location.search);
  const as = query.get("as") ?? "patient";
  const initialMe = PEOPLE[as] ?? PEOPLE.patient!;
  const [me, setMe] = useState(initialMe);
  setPreviewCaller(me);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMe((prev) => ({ ...prev, ...detail }));
    };
    window.addEventListener("atria:me-updated", onUpdated);
    return () => window.removeEventListener("atria:me-updated", onUpdated);
  }, []);

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
