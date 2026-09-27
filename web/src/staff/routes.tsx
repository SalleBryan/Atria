/**
 * The staff console's screens, inside their shell. Shared by the app and by
 * the development preview (src/dev), so both render exactly the same routes.
 */

import { Route } from "react-router-dom";

import { AuditLog } from "./AuditLog";
import { Availability } from "./Availability";
import { DaySchedule } from "./DaySchedule";
import { Settings } from "./Settings";
import { StaffAccounts } from "./StaffAccounts";
import { StaffShell } from "./StaffShell";
import { VisitPage } from "./VisitPage";
import { WeekView } from "./WeekView";

export const staffRoutes = (
  <Route element={<StaffShell />}>
    <Route path="/console" element={<DaySchedule />} />
    <Route path="/console/week" element={<WeekView />} />
    <Route path="/console/visits/:id" element={<VisitPage />} />
    <Route path="/console/availability" element={<Availability />} />
    <Route path="/console/staff" element={<StaffAccounts />} />
    <Route path="/console/audit" element={<AuditLog />} />
    <Route path="/console/settings" element={<Settings />} />
  </Route>
);
