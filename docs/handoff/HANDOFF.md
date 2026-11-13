# Atria handoff for a second Claude account

Written 2026-11-13 for the teammate's Claude. Two Claude accounts push to this one repo. Read this file fully before touching code. Verify any claim against the code before relying on it: files change, and parts of this come from older notes.

## 1. The two lanes

| Lane | Owner | Goal |
| --- | --- | --- |
| Pain lane | first account | Build what makes the three pitched pain points real: (1) waiting without knowing, (2) not reachable by app or SMS alone, (3) not knowing the cost |
| Business lane | you | Build what makes the business plan real: how Atria earns money |

Hackathon brief: pick a real everyday barrier and a named real user group. Atria is a healthcare appointment booking and reminder system for Cameroon (tenant: Regional Hospital Buea, hypothetical).

### Pain lane backlog (do not take these)
1. **Queue revision, ADR 0022 (accepted 2026-11-13, slice 1 in review, slices 2 and 3 to come).** Work-conserving queue with bounded bypass: the doctor never idles when someone is present, an on-time patient is bypassed at most once, early-call invitations run in parallel and never hold the doctor, lateness forfeits priority, clinical urgency overrides. Read `docs/adr/0022-*.md` before touching `core/queue.py` or `services/booking/queue.py`.
2. Live queue position or estimate on the ticket (measured consultation length, not a fixed 30 minutes); voice reminder fallback and local-language messages; fee in reminders and on the desk view.
3. Remaining audit findings (`docs/reference/reviews/2026-11-04/AUDIT.md`): F02, F04, F05, F06 and the P2 list. Production SMS (OI-04) is an owner action.

### Business lane backlog (yours), in order
1. **B0, decision first.** The SRS says tenant onboarding commercial terms, per-tenant branding and billing are OUT OF SCOPE (FR-TEN-03), and no payment function exists before Phase 3 (FR-MSR-07). Write an ADR that moves commercial scope into Phase 3 before building a plan record or invoices. Ask the owner to confirm.
2. **B1, usage metering and monthly statement.** Source: the message log (`backend/src/atria/data/messages.py`; rows carry clinicId, kind, channel, template, status, sentAt; partitioned by day, MessageDayIndex). Counts per tenant and unit by channel and status. This is reporting, not billing.
3. **B2, baseline report.** Extend the pure arithmetic in `backend/src/atria/core/report.py` and `services/directory/report.py` with a before and after period comparison. Fix audit F18 first: the chart and the CSV divide by different denominators. Name three percentages separately: share of booked, share of closed outcomes, attendance rate (attended over attended plus no-show). No patient identifiers, no currency savings.
4. **B3, tenant plan record and invoice PDF.** Read only plan card in admin Settings; invoice via `web/src/utils/export/pdf.ts`. Atria moves no money.
5. **B4, onboarding checklist** for a new unit using the existing importers (`BatchStaffImport.tsx`, `BatchPatientImport.tsx`).
6. Later: claims-ready fee ledger export (needs a partner). Mobile money is roadmap only.

## 2. Multi-tenancy: what exists and what does not
- Exists: every storage key starts with the tenant id (FR-TEN-01, tested in `backend/tests/data/test_keys.py`). Tenant item `TENANT#t / META`, region pack (`REGION#CM`), the `tenantId` claim set in `services/identity/pre_token.py` and refused by the authoriser when missing.
- Does not exist (verify): a tenant creation route or tool other than `tools/seed_dev.py`; a platform operator role above TENANT_ADMIN (the five roles are PATIENT, RECEPTIONIST, CLINICIAN, CLINIC_MANAGER, TENANT_ADMIN in `spec/atria_spec/roles.py`); per-tenant web site. `web/src/tenant.ts` is fixed to one hospital.
- So: multi-tenancy is a data fact, not the missing piece. Cross-tenant billing needs a new operator concept. That is a spec change and an owner decision.

## 3. Non-negotiables
- No em dashes or en dashes anywhere: prose, code comments, commits, UI copy.
- No AI attribution in commits or PR text (no Co-Authored-By, no "generated with"). Conventional commits, scopes as in CONTRIBUTING.md.
- Never type real passwords into forms. Never create accounts on non-local services without the owner saying so.
- Synthetic data only. The deployed dev app already holds real patient accounts: never book, cancel or edit those. Use the test staff accounts (Test Receptionist, Test Clinician, Test Manager). Credentials are NOT in the repo; ask the owner.
- Ratings never touch prices (AD-11). No currency savings claims (CX-12, FR-MSR-04). No ads, no selling data, no charging patients to book.
- English only in UI until the language phase. Administrators are web only (ADR 0021).
- Run the full CI set before every push, including the Flutter job. A push is unfinished until CI and Deploy are green.
- Work one screen at a time, screenshot each. Never bulk-restyle. Report faithfully, including what you did not verify.
- Do not spawn large agent fan-outs. Sequential, or two or three at once.

## 4. Working together (two accounts, one repo)
- Branches: `pain/<subject>` and `biz/<subject>`; docs `docs/<subject>`. Branch from fresh `origin/main`. Rebase, do not merge main in. Small PRs.
- ADR numbers: pain lane 0022 to 0029, business lane 0030 and up.
- Hotspots, edit additively and keep diffs small: `spec/atria_spec/*`, `docs/openapi/atria.yaml`, `web/src/generated/*` (never hand-merge: after a rebase run `python spec/generate.py` and commit the result), `infra/atria_infra/stacks/api.py`, `web/src/staff/Settings.tsx`, `web/src/staff/Reports.tsx`, `.github/workflows/*`.
- Lane logs: each account appends status to its own file, `docs/handoff/LOG_PAIN.md` or `docs/handoff/LOG_BIZ.md`. Never edit the other's.
- Deploys: Deploy runs after CI passes on main and is gated by reviewers on the `dev` environment. Do not trigger two at once. A stuck Amplify PENDING job blocks new ones (`aws amplify stop-job`).
- Merging is the owner's call. Open PRs, do not merge.
- **Update this handoff before every push** (owner's rule, 2026-11-13): refresh section 8 (current state) and append to your lane log in the same push. Fetch first and read the other lane's log and branches.
- **No hard-coded policy.** Values a hospital may want to tune are settings by level (tenant, unit, session), edited by the right role, with built-in constants only as the fallback.

## 5. Repo map (root is `Atria/`)
- `spec/atria_spec/`: single source: roles and permission matrix, entities, keys, lifecycles, region packs, `hospital.py` seed data. Change here first, then `python spec/generate.py`.
- `backend/src/atria/`: `core/` pure rules, `data/` repository and key builders, `http/` request and response layer, `services/` Lambda handlers (admin, audit, authoriser, booking, directory, identity, notify, patients). Tests in `backend/tests` run on moto.
- `infra/atria_infra/stacks/`: CDK in Python (platform, data, identity, api, async_stack, hosting, observability, cost_guard, deploy_access).
- `web/src/`: React 19, Vite, TypeScript. `patient/`, `staff/` (console, also admin), `components/` shared parts, `styles/` (tokens.css, tiers.css loaded last), `utils/export/` (pdf, sheet, csv, tokens), `dev/` (preview mock API), `generated/`.
- `app/`: Flutter (patients and staff). `tools/`: seed, smoke scripts, deploy_web.py. `docs/adr/`: 21 decisions. `docs/constraints.md`, `docs/openapi/atria.yaml`, `docs/runbooks/redrive.md`.
- Data: one main DynamoDB table plus a care-context table. Indexes: PatientIndex, ClinicianIndex, ClinicDayIndex, PersonIndex, OutboxIndex, DirectoryIndex, MessageDayIndex. Fee bands are versioned (`FEE#id / FROM#date`). Ledger entry per visit at closure; nothing settles.

## 6. Recipes
- **New endpoint:** permission in `spec/roles.py` MATRIX (if it is not listed it does not exist) -> service in `backend/src/atria/services/...` using `core/permissions.py` Subject scopes -> route in `infra/.../api.py` -> contract in `docs/openapi/atria.yaml` -> test naming the requirement (`test_fr_xxx_...`) -> web client.
- **New web screen:** reuse parts: `FilterMenu`, `SearchSuggest`, `Pager` (50 rows), `Pickers` (no native select, checkbox or date input), `PhoneField`, `RowActions`, `Selection`, `LoadingPane`, dialogs with an x top right. One filled primary per action group. Status chips in normal case (CSS capitalises). Counts are M3 large badges. Every screen animates on M3 Expressive springs (ADR 0019); honour reduced motion.
- **New export (PDF, Excel, CSV):** always through `web/src/utils/export/` (`AtriaPdf`, `AtriaSheet`, `csvText`), tokens in `export/tokens.ts`. Example: `web/src/utils/reportExport.ts`.
- **Design tokens:** web `web/src/styles/tokens.css`; document tokens `atria.tokens.json` (outside the repo, see section 9); app `app/lib/theme/tokens.dart`. Patient and staff are blue, admin is purple (#8B5CF0 family). Never default ink to brand blue. Keep the Rev A look; add tokens, never consolidate.
- **Layout:** zoom by width only (canvas 1440 wide); tiers: desktop 1200 and up, tablet 768 to 1199, mobile under 768. Check 1280x720, 1280x551 and a phone. No overflow at any size.

## 7. Verify and CI (exactly what CI runs)
Backend: `ruff check spec backend`, `ruff format --check spec backend`, `cd backend && mypy && pytest --cov-fail-under=85`. Spec: `python spec/generate.py --check`. Infra: in `infra/`: `ruff check .`, `ruff format --check .`, `mypy .`, `pytest`, `npx aws-cdk@2 synth --quiet`. Web: in `web/`: `npm run format:check`, `npm run typecheck`, `npm test`, `npx vite build`. Flutter: in `app/`: `dart format --output=none --set-exit-if-changed lib test`, `flutter analyze`, `flutter test`. CI pins Flutter 3.47.5.

Gotchas (Windows, Git Bash, OneDrive):
- Quote every path with spaces. Use the repo `.venv`; put `.venv/Scripts` first on PATH before `cdk synth` or it uses the wrong Python.
- CI uses npm (`package-lock.json`). `package.json` may show a local `packageManager` reorder from a pnpm tool: do not commit it.
- Vite on OneDrive can serve stale files after multi-step edits: touch the files and reload.
- Preview without credentials: `http://localhost:5173/__preview?as=patient|receptionist|clinician|manager|admin` (mock API in `web/src/dev/mockApi.ts`, state resets on reload). The mock unit has no queue.
- Prefer DOM measurements over screenshots; screenshots catch animations mid-flight. Use real pointer clicks to test overlays.
- Set `MSYS_NO_PATHCONV=1` for `/aws/lambda/...` log commands.

## 8. Current state (updated 2026-11-13, pain lane, after queue slice 1 and the urgent-marking decision)
- Merged to main: PR 20 (fee before booking, cancelled tickets, pickers above dialogs, request wording, per-doctor pace, Flutter pinned to 3.47.5), PR 21 (this handoff, `docs/reference/`, `CLAUDE.md`, ADR 0022). Deploy for PR 20 was approved and running on 2026-11-13: confirm the run and the live app.
- Open: PR for queue slice 1 (branch `pain/queue-revision`): `core/queue.py::next_call` decides who is called (never idle, bypass bounded, hold, late, urgent); `call_next` applies it; live queue returns `callPreview`, per-ticket flags and `policy`. Queue rules are settings by level: tenant (`PATCH /admin/settings`: `queueHoldMinutes`, `queueLateGraceMinutes`, `queueMaxBypass`), unit (`PATCH /clinics/{id}/queue-policy`), session (`PATCH /sessions/{id}/policy`). New permissions `queue.configure` and `queue.tune_session` (the SRS permission matrix PDF does not list them yet).
- Decision 2026-11-13: only the receptionist may mark a ticket urgent (permission `queue.mark_urgent`, receptionist clinic scope only, reason required, audited). Do not widen it to clinicians or managers without the owner.
- PR 22 (slice 1) has all five CI jobs green. PR 20's Deploy succeeded; the dev app has the fee line and fixes.
- Not built yet (pain lane, in order): slice 2 desk console (call guard, hold countdown, urgent marking with its permission and route, screens to edit the three levels); slice 3 early-call invitations, `EARLY_CALL_INVITE` and `QUEUE_MOVED` messages, invitation settings on the same three levels.
- Live dev app: `https://main.dym1ejjx8bhtw.amplifyapp.com`. SMS and email are in AWS sandbox (OI-04): no real patient receives a text yet. A test queue session exists for 2026-11-13. The staff list is cluttered with deleted and suspended test accounts (audit F05). A duplicate clinician "Emmanuel Ekane" exists as created data.
- Open audit findings relevant to the business lane: F18 (percentage denominators), F08 (clinician report destination), F13 (failed message follow-up state).
- Business lane: nothing pushed yet as of this update (no branch, empty `LOG_BIZ.md`).

## 9. Reference material (now in the repo)
Everything that used to sit outside the repo is under `docs/reference/` (index: `docs/reference/README.md`): SRS, Technical Document and Design Spec Rev B PDFs, `atria.tokens.json`, the PDF builder (`design-system/document-builder/atria_doc.py`), the evidence report and pitch map, the audit (text only), and `WORKING_RULES.md`. The repo is public: never add credentials, account or pool ids, staff workbooks or screenshots of real records. Reports for the owner are PDFs in the Atria house style, not Markdown; this handoff is the exception.

## 10. Claims you may and may not make
- No verified Cameroon SMS tariff, willingness to pay, signed carrier rate or competitor subscription price exists. Do not invent prices or a revenue forecast. Three conversations close this: a hospital manager, an SMS aggregator, a district health office.
- Evidence on reminders is mixed (one-way SMS helps in low-bias African trials, two-way does not). Do not claim reductions in no-shows or any currency saving. Sell measurement, not promised gains.
- Safe to say: what is built, what is next, and that pricing comes from those conversations.

## 11. First hour checklist
1. Read CONTRIBUTING.md, docs/adr/README.md, docs/constraints.md, spec/README.md.
2. `git fetch`, branch `biz/<subject>` from origin/main. Run the CI set once to see a green baseline.
3. Write the B0 ADR and ask the owner to confirm the scope change before any billing code.
4. Start B1 with a test first. Log progress in `docs/handoff/LOG_BIZ.md`.

## 12. Queue revision: what it changes for the business lane (from ADR 0022)
- **B1 metering:** new message kinds `EARLY_CALL_INVITE` and `QUEUE_MOVED` will appear in the message log. Count them by kind per unit. They are time critical, so delivery speed matters more than for reminders.
- **B2 baseline report:** add queue-quality metrics next to attendance: doctor idle minutes, arrival-to-consultation wait, promise breach minutes (consultation start minus window end for patients who arrived in their window), bypass rate, on-site versus online mix. Consultation length is derived from the existing `consultationStartedAt` and `completedAt` stamps on the ticket; no new event. State them as measurements only, never as currency savings (FR-MSR-04, CX-12).
- **Settings are not plan tiers.** `queueHoldMinutes`, `queueLateGraceMinutes`, `queueMaxBypass` (and later the invitation settings and a possible walk-in reserve share) are configuration set by tenant, unit or session. Do not attach them to pricing before B0 is decided.
- **Coordination:** the pain lane owns `core/queue.py`, `services/booking/queue.py` and the ticket fields. The business lane reads them; if you need a field, ask in `LOG_BIZ.md` and let the pain lane add it so the two do not edit the same files.
