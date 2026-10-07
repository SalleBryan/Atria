/**
 * Batch creation of patient records via Excel import (2026-10-01).
 *
 * Allows hospital administrators and staff with patient.create to register
 * patients in bulk from a spreadsheet.
 */

import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { Notice } from "../components/controls";
import { CheckMark, Close, Download, Upload, Users } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { downloadPatientTemplate, parsePatientExcel, type ParsedPatientRow } from "../utils/excelImport";
import type { RegisterEntry } from "./Patients";

interface CreatedPatient {
  row: ParsedPatientRow;
  patient: RegisterEntry;
}

interface FailedPatient {
  row: ParsedPatientRow;
  reason: string;
}

export function BatchPatientImport({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (createdCount: number) => void;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "running" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedPatientRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [successes, setSuccesses] = useState<CreatedPatient[]>([]);
  const [failures, setFailures] = useState<FailedPatient[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(selectedFile: File) {
    setParseError(null);
    setFile(selectedFile);
    try {
      let existingPatients: { phoneE164?: string | null }[] = [];
      try {
        const patRes = await api<{ results?: { phoneE164?: string }[] }>("/patients");
        existingPatients = patRes.results ?? [];
      } catch {
        // Continue with empty list if prefetch fails
      }
      const result = await parsePatientExcel(selectedFile, undefined, existingPatients);
      if (result.rows.length === 0) {
        setParseError("The uploaded file contains no patient rows.");
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
    const validRows = rows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setStep("running");
    setProgress({ current: 0, total: validRows.length });

    const created: CreatedPatient[] = [];
    const failed: FailedPatient[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]!;
      setProgress({ current: i + 1, total: validRows.length });

      const body: Record<string, unknown> = {
        givenName: r.givenName,
        familyName: r.familyName,
        phoneE164: r.phoneE164,
      };
      if (r.dateOfBirth) body.dateOfBirth = r.dateOfBirth;

      try {
        const res = await api<RegisterEntry>("/patients", {
          method: "POST",
          json: body,
        });
        created.push({ row: r, patient: res });
      } catch (caught) {
        failed.push({
          row: r,
          reason: caught instanceof Error ? caught.message : "Failed to register patient.",
        });
      }
    }

    setSuccesses(created);
    setFailures(failed);
    setStep("done");
  }

  const validCount = rows.filter((r) => r.valid).length;
  const errorCount = rows.length - validCount;

  return createPortal(
    <div className="scrim" onClick={() => step !== "running" && onClose()}>
      <div
        className="dialog staff-dialog batch-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-batch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <span className={`sheet-icon${step === "done" ? " sheet-icon-done" : ""}`} aria-hidden="true">
            {step === "done" ? <CheckMark size={22} /> : <Users size={22} />}
          </span>
          <span className="sheet-title">
            <h2 id="patient-batch-title">
              {step === "upload" && "Import patients from Excel"}
              {step === "preview" && "Preview patient import"}
              {step === "running" && "Registering patients"}
              {step === "done" && `${successes.length} ${successes.length === 1 ? "patient" : "patients"} registered`}
            </h2>
            <p>
              {step === "upload" && "Upload a spreadsheet with patient details or download the formatted template."}
              {step === "preview" && "Review the patient records parsed from your spreadsheet before registering them."}
              {step === "running" && "Creating patient profiles in the hospital register."}
              {step === "done" && "Patient records created and numbers assigned for booking."}
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
                    Download our formatted template with columns for given name, family name, mobile, date of birth,
                    and language preference.
                  </p>
                </div>
                <button type="button" className="outline-button" onClick={() => void downloadPatientTemplate()}>
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
              <span>Registering patients creates minimal records with assigned patient numbers.</span>
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
                  Rows with invalid mobile numbers or missing names will be skipped.
                </Notice>
              )}

              <div className="batch-table-container">
                <table className="batch-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Name</th>
                      <th>Mobile</th>
                      <th>Date of Birth</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rowNumber} className={row.valid ? "row-valid" : "row-invalid"}>
                        <td className="row-num">{row.rowNumber}</td>
                        <td className="row-name">
                          <strong>{row.givenName} {row.familyName}</strong>
                        </td>
                        <td className="row-mobile">{row.phoneRaw}</td>
                        <td className="row-dob">{row.dateOfBirth ?? "Not given"}</td>
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
              <span>{validCount} patients will be registered.</span>
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
                Register {validCount} {validCount === 1 ? "patient" : "patients"}
              </button>
            </footer>
          </>
        )}

        {step === "running" && (
          <div className="batch-body batch-running-state">
            <LoadingIndicator size={36} label="Registering patients" />
            <h3>Registering patients</h3>
            <p>
              Processing patient {progress.current} of {progress.total}...
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
              <Notice tone="success">
                Successfully registered {successes.length} {successes.length === 1 ? "patient" : "patients"} in the hospital register.
              </Notice>

              {failures.length > 0 && (
                <Notice tone="error">
                  {failures.length} {failures.length === 1 ? "patient" : "patients"} could not be registered:
                  <ul className="batch-failed-list">
                    {failures.map((f, idx) => (
                      <li key={idx}>
                        {f.row.givenName} {f.row.familyName} ({f.row.phoneRaw}): {f.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}

              <div className="batch-table-container">
                <table className="batch-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Mobile</th>
                      <th>Patient Number</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {successes.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong>{item.row.givenName} {item.row.familyName}</strong>
                        </td>
                        <td>{item.row.phoneE164}</td>
                        <td>
                          <span className="chip chip-neutral">{item.patient.patientNumber ?? "Assigned"}</span>
                        </td>
                        <td>
                          <span className="badge-valid">Registered</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="sheet-foot">
              <span>Each patient can be booked as soon as they are added.</span>
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
