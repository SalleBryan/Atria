/**
 * Credentials for new or reissued staff accounts, as a PDF to hand over
 * (2026-10-01, restyled 2026-10-07 in the documents' style, utils/export).
 *
 * A cover names the hospital, how many accounts and when the passwords stop
 * working; each account follows on its own white sheet, with the sign-in
 * name and the temporary password set in the mono face so 0 and O, 1 and l
 * cannot be mistaken; the first sign-in steps close the document.
 */

import { TENANT } from "../tenant";
import { AtriaPdf } from "./export/pdf";
import { fileName, madeAt } from "./export/tokens";

export interface StaffCredential {
  name: string;
  role: string;
  unit: string;
  signInName: string;
  temporaryPassword: string;
  email?: string | null;
  phone?: string | null;
}

/** How long a temporary password works (infra identity stack, temp_password_validity). */
const VALID_DAYS = 7;

const STEPS = [
  "Open the Atria staff console and choose Sign in.",
  "Enter the sign-in name and the temporary password above, exactly as shown.",
  "Choose your own password when asked. The temporary one then stops working.",
  `The temporary password expires ${VALID_DAYS} days after it was issued. Ask your administrator for a new one if it does.`,
  "Keep this page private, and destroy it once you have signed in.",
];

async function credentialsPdf(credentials: StaffCredential[], name: string) {
  const pdf = await AtriaPdf.create("ATR-CRD · Staff credentials");
  const one = credentials.length === 1 ? credentials[0] : undefined;
  pdf.cover({
    kicker: "Staff credentials · Confidential",
    title: one ? one.name : `${credentials.length} staff accounts`,
    lede: one
      ? `${one.role}, ${one.unit}. Hand this page to the account holder in person or through a trusted channel.`
      : "One sheet per account. Hand each to its holder in person or through a trusted channel.",
    meta: [
      { label: "Hospital", value: TENANT.name },
      { label: "Issued", value: madeAt() },
      { label: "Valid for", value: `${VALID_DAYS} days` },
      { label: "Accounts", value: String(credentials.length) },
    ],
  });
  credentials.forEach((credential, i) => {
    pdf.keep(52);
    // One account: the cover already names them, so the sheet is just the details.
    pdf.heading(String(i + 1).padStart(2, "0"), one ? "Sign-in details" : credential.name, `${credential.role} · ${credential.unit}`);
    pdf.table(
      [
        { label: "Sign-in name", width: 1, mono: true },
        { label: "Temporary password", width: 1, mono: true },
      ],
      [[credential.signInName, credential.temporaryPassword]],
    );
  });
  pdf.callout(
    "At the first sign-in",
    STEPS.map((step, i) => `${i + 1}. ${step}`),
  );
  pdf.save(name);
}

export function downloadSingleStaffPdf(credential: StaffCredential) {
  return credentialsPdf([credential], fileName(["Staff credentials", credential.name], "pdf"));
}

export function downloadBatchStaffPdf(credentials: StaffCredential[]) {
  return credentialsPdf(
    credentials,
    fileName(["Staff credentials", `${credentials.length} accounts`, new Date().toISOString().slice(0, 10)], "pdf"),
  );
}
