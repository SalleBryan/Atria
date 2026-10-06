/**
 * Batch creation of staff accounts via Excel import (2026-10-01).
 *
 * Provides a multi-step modal:
 * 1. Download template or upload an Excel spreadsheet.
 * 2. Preview and validate rows against role-specific requirements.
 * 3. Batch execute creation against POST /admin/staff.
 * 4. Display generated one-time credentials with PDF export.
 */

import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { Notice } from "../components/controls";
import { CheckMark, Clipboard, Close, Download, Upload, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { downloadBatchStaffPdf, type StaffCredential } from "../utils/credentialPdf";
import { downloadStaffTemplate, parseStaffExcel, type ParsedStaffRow } from "../utils/excelImport";
import { useStaffData } from "./data";

interface CreatedAccount {
  row: ParsedStaffRow;
  signInName: string;
  temporaryPassword: string;
}

interface FailedAccount {
  row: ParsedStaffRow;
  reason: string;
}

export function BatchStaffImport({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (createdCount: number) => void;
}) {
  const { state: directory } = useStaffData();
  const clinics = directory.status === "ready" ? directory.data.clinics : [];

  const [step, setStep] = useState<"upload" | "preview" | "running" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedStaffRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Execution state
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [successes, setSuccesses] = useState<CreatedAccount[]>([]);
  const [failures, setFailures] = useState<FailedAccount[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(selectedFile: File) {
    setParseError(null);
    setFile(selectedFile);
    try {
      let existingAccounts: { phoneE164?: string | null; email?: string | null; signInName?: string | null }[] = [];
      try {
        const staffRes = await api<{ accounts: { phoneE164?: string; email?: string; signInName?: string }[] }>("/admin/staff?limit=50");
        existingAccounts = staffRes.accounts ?? [];
      } catch {
        // Continue with empty list if prefetch fails
      }
      const result = await parseStaffExcel(selectedFile, clinics, undefined, existingAccounts);
      if (result.rows.length === 0) {
        setParseError("The uploaded file does not contain any valid staff data rows.");
        return;
      }
      setRows(result.rows);
      setStep("preview");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse Excel file.");
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      void handleFile(selected);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      void handleFile(dropped);
    }
  }

  async function executeBatch() {
    const validRows = rows.filter((r) => r.valid && r.role);
    if (validRows.length === 0) return;

    setStep("running");
    setProgress({ current: 0, total: validRows.length });

    const created: CreatedAccount[] = [];
    const failed: FailedAccount[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]!;
      setProgress({ current: i + 1, total: validRows.length });

      const body: Record<string, unknown> = {
        givenName: r.givenName,
        familyName: r.familyName,
        phoneE164: r.phoneE164,
        roles: [r.role!],
      };
      if (r.email) body.email = r.email;
      if (r.employeeNumber) body.employeeNumber = r.employeeNumber;
      if (r.clinicId) body.clinicId = r.clinicId;
      if (r.role === "CLINICIAN") {
        body.specialty = r.specialty;
        body.registrationYear = r.registrationYear;
        body.ordreNumber = r.ordreNumber;
        body.languages = r.languages;
      }

      try {
        const res = await api<{ signInName: string; temporaryPassword: string }>("/admin/staff", {
          method: "POST",
          json: body,
        });
        created.push({
          row: r,
          signInName: res.signInName,
          temporaryPassword: res.temporaryPassword,
        });
      } catch (caught) {
        failed.push({
          row: r,
          reason: caught instanceof Error ? caught.message : "Failed to create account.",
        });
      }
    }

    setSuccesses(created);
    setFailures(failed);
    setStep("done");
  }

  function downloadCredentials() {
    const credentials: StaffCredential[] = successes.map((s) => ({
      name: `${s.row.givenName} ${s.row.familyName}`.trim(),
      role: s.row.roleLabel,
      unit: s.row.clinicName ?? "All units",
      signInName: s.signInName,
      temporaryPassword: s.temporaryPassword,
      email: s.row.email,
      phone: s.row.phoneE164,
    }));
    downloadBatchStaffPdf(credentials);
  }

  const validCount = rows.filter((r) => r.valid).length;
  const errorCount = rows.length - validCount;

  return createPortal(
    <div className="scrim" onClick={() => step !== "running" && onClose()}>
      <div
        className="dialog staff-dialog batch-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <span className={`sheet-icon${step === "done" ? " sheet-icon-done" : ""}`} aria-hidden="true">
            {step === "done" ? <CheckMark size={22} /> : <Users size={22} />}
          </span>
          <span className="sheet-title">
            <h2 id="batch-title">
              {step === "upload" && "Import staff accounts"}
              {step === "preview" && "Preview staff import"}
              {step === "running" && "Creating staff accounts"}
              {step === "done" && `${successes.length} ${successes.length === 1 ? "account" : "accounts"} created`}
            </h2>
            <p>
              {step === "upload" && "Download the template or upload an Excel file to create accounts in bulk."}
              {step === "preview" && "Check the accounts parsed from your spreadsheet before creating them."}
              {step === "running" && "Creating accounts and generating one-time credentials."}
              {step === "done" && "Pass these credentials on in person. This is the only time passwords are shown."}
            </p>
          </span>
          {step !== "running" && (
            <button type="button" className="square-button" aria-label="Close" onClick={onClose}>
              <Close size={16} />
            </button>
          )}
        </header>

        {step === "upload" && (
          <>
            <div className="batch-body">
              <div className="batch-template-card">
                <div>
                  <h3>Excel template</h3>
                  <p>
                    Download our formatted template with sample rows for Receptionists, Clinicians, Unit Managers, and
                    Administrators, including your hospital units.
                  </p>
                </div>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => downloadStaffTemplate(clinics)}
                >
                  <Download size={16} />
                  Download template
                </button>
              </div>

              <div
                className={`batch-dropzone${dragOver ? " dropzone-active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  style={{ display: "none" }}
                  onChange={onFileChange}
                />
                <span className="dropzone-icon" aria-hidden="true">
                  <Upload size={28} />
                </span>
                <p className="dropzone-title">Click to upload or drag and drop spreadsheet</p>
                <p className="dropzone-hint">Supports .xlsx and .xls files</p>
              </div>

              {parseError && <Notice tone="error">{parseError}</Notice>}
            </div>

            <footer className="sheet-foot">
              <span>Creating accounts in bulk is logged against your administrator user.</span>
              <button type="button" className="outline-button sheet-cancel" onClick={onClose}>
                Cancel
              </button>
            </footer>
          </>
        )}

        {step === "preview" && (
          <>
            <div className="batch-body">
              <div className="batch-summary-stats">
                <span className="batch-stat-total">
                  Total rows: <strong>{rows.length}</strong>
                </span>
                <span className="batch-stat-badge stat-valid">
                  <CheckMark size={13} /> {validCount} ready
                </span>
                {errorCount > 0 && (
                  <span className="batch-stat-badge stat-error">
                    {errorCount} with {errorCount === 1 ? "an error" : "errors"}
                  </span>
                )}
                {file && <span className="batch-file-name">{file.name}</span>}
              </div>

              {errorCount > 0 && (
                <Notice tone="info">
                  Rows with errors will be skipped during account creation. You can fix your spreadsheet and upload
                  again, or proceed with the valid rows.
                </Notice>
              )}

              <div className="batch-table-container">
                <table className="batch-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Role</th>
                      <th>Name</th>
                      <th>Mobile</th>
                      <th>Unit / Email</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rowNumber} className={row.valid ? "row-valid" : "row-invalid"}>
                        <td className="row-num">{row.rowNumber}</td>
                        <td className="row-role">
                          <span className="chip chip-neutral">{row.roleLabel}</span>
                        </td>
                        <td className="row-name">
                          <strong>{row.givenName} {row.familyName}</strong>
                          {row.role === "CLINICIAN" && row.specialty && (
                            <span className="row-subtext">{row.specialty}</span>
                          )}
                        </td>
                        <td className="row-mobile">{row.phoneRaw}</td>
                        <td className="row-unit">
                          {row.clinicName ?? row.email ?? "None"}
                        </td>
                        <td className="row-status">
                          {row.valid ? (
                            <span className="badge-valid">Ready</span>
                          ) : (
                            <div className="row-errors">
                              {row.errors.map((err, i) => (
                                <span key={i} className="row-error-item">{err}</span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="sheet-foot">
              <span>{validCount} accounts will be created.</span>
              <button
                type="button"
                className="outline-button sheet-cancel"
                onClick={() => {
                  setStep("upload");
                  setRows([]);
                  setFile(null);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="staff-primary sheet-primary"
                disabled={validCount === 0}
                onClick={() => void executeBatch()}
              >
                Create {validCount} {validCount === 1 ? "account" : "accounts"}
              </button>
            </footer>
          </>
        )}

        {step === "running" && (
          <div className="batch-body batch-running-state">
            <LoadingIndicator size={36} label="Creating staff accounts" />
            <h3>Creating staff accounts</h3>
            <p>
              Processing account {progress.current} of {progress.total}...
            </p>
            <div className="batch-progress-bar">
              <div
                className="batch-progress-fill"
                style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {step === "done" && (
          <>
            <div className="batch-body">
              <div className="batch-done-actions">
                <Notice tone="info">
                  The temporary passwords work for 7 days. At first sign-in they choose their own password on the staff
                  sign-in page.
                </Notice>
                {successes.length > 0 && (
                  <button
                    type="button"
                    className="staff-primary batch-download-pdf-btn"
                    onClick={downloadCredentials}
                  >
                    <Download size={16} />
                    Download credentials (PDF)
                  </button>
                )}
              </div>

              {failures.length > 0 && (
                <Notice tone="error">
                  {failures.length} {failures.length === 1 ? "account" : "accounts"} could not be created:
                  <ul className="batch-failed-list">
                    {failures.map((f, idx) => (
                      <li key={idx}>
                        {f.row.givenName} {f.row.familyName} ({f.row.phoneRaw}): {f.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}

              <div className="batch-credentials-list">
                {successes.map((item, idx) => (
                  <div key={idx} className="batch-credential-card">
                    <div className="cred-card-head">
                      <div>
                        <h4>
                          {item.row.givenName} {item.row.familyName}
                        </h4>
                        <span className="cred-card-meta">
                          {item.row.roleLabel} · {item.row.clinicName ?? "All units"}
                        </span>
                      </div>
                    </div>
                    <div className="cred-card-secrets">
                      <SecretField label="Sign-in name" value={item.signInName} />
                      <SecretField label="Temporary password" value={item.temporaryPassword} mono />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="sheet-foot">
              <span>Creating accounts was logged against your admin user.</span>
              <button
                type="button"
                className="staff-primary sheet-primary"
                onClick={() => onDone(successes.length)}
              >
                Done
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SecretField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <div className="secret">
      <span className="secret-label">{label}</span>
      <span className={`secret-value${mono ? " secret-mono" : ""}`}>{value}</span>
      <button type="button" className="secret-copy" onClick={copy}>
        {copied ? <CheckMark size={14} /> : <Clipboard size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
