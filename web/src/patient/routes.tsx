/**
 * The patient screens, inside their shell. Shared by the app and by the
 * development preview (src/dev), so both render exactly the same routes.
 */

import { Route } from "react-router-dom";

import { Booked } from "./Booked";
import { FindCare } from "./FindCare";
import { PatientHome } from "./PatientHome";
import { PatientShell } from "./PatientShell";
import { Soon } from "./Soon";

export const patientRoutes = (
  <Route element={<PatientShell />}>
    <Route path="/home" element={<PatientHome />} />
    <Route path="/find-care" element={<FindCare />} />
    <Route path="/booked/:id" element={<Booked />} />
    <Route path="/visits" element={<Soon title="My visits" />} />
    <Route path="/visits/:id" element={<Soon title="Visit" />} />
    <Route path="/account" element={<Soon title="Account" />} />
  </Route>
);
