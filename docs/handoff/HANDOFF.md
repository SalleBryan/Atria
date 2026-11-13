# Atria handoff for a second Claude account

Written 2026-11-13 for the teammate's Claude. Two Claude accounts push to this one repo. Read this file fully before touching code. Verify any claim against the code before relying on it: files change, and parts of this come from older notes.

## 1. The two lanes

| Lane | Owner | Goal |
| --- | --- | --- |
| Pain lane | first account (Claude) | Build what makes the three pitched pain points real: (1) waiting without knowing, (2) not reachable by app or SMS alone, (3) not knowing the cost |
| Business lane | you | Build what makes the business plan real: how Atria earns money |

Hackathon brief: pick a real everyday barrier and a named real user group. Atria is a healthcare appointment booking and reminder system for Cameroon (tenant: Regional Hospital Buea, hypothetical).

### Pain lane backlog (do not take these)
1. **Queue revision, ADR 0022 (accepted 2026-11-13, slice 1 in review, slices 2 and 3 to come).** Work-conserving queue with bounded bypass: the doctor never idles when someone is present, an on-time patient is bypassed at most once, early-call invitations run in parallel and never hold the doctor, lateness forfeits priority, clinical urgency overrides. Read `docs/adr/0022-*.md` before touching `core/queue.py` or `services/booking/queue.py`.
2. Live queue position or estimate on the ticket (measured consultation length, not a fixed 30 minutes); voice reminder fallback and local-language messages; fee in reminders and on the desk view.
3. Remaining audit findings (`docs/reference/reviews/2026-11-04/AUDIT.md`): F02, F04, F05, F06 and the P2 list. Production SMS (OI-04) is an owner action.

### Who does what now (Codex left the project 2026-11-13: two accounts only)
Only the pain lane account and the business lane account work in this repo. A third agent, Codex, started on the pain lane and left with nothing pushed. Its unfinished work is on the owner's disk as uncommitted edits in `C:/Users/Bryan/.codex/worktrees/` (five worktrees: `patient-messaging`, `unit-deletion`, `staff-reactivation`, `procedure-sizing`, `flutter-queue-desk`) and was saved as patches. It is unverified. Adopt it only by reading the diff, redoing or applying it on a fresh `pain/<subject>` branch from `origin/main`, running the full CI set, and opening a small PR. Never push a Codex branch as it stands.

**Pain lane account (owns `core/queue.py`, `services/booking/queue.py`, `data/sessions.py`, the staff queue screens), in order:**
1. P1 patient live ticket view: built on `pain/live-ticket` (`GET /appointments/{id}/ticket`), in CI.
2. Fee in reminders: built on `pain/fee-in-reminders` (confirmation and reminder SMS and email state the fee band in force on the visit day, or "free"; `core/notices.py::fee_text`, `services/notify/sender.py::appointment_fee`). The desk view of the fee is still to do. Local-language messages are being handled by the other account for now (do not edit `language_for` or `OFFERED` in `core/notices.py` from this lane without asking).
3. Audit F05 (staff reactivation, new permission, spec first), F02 (unit deletion dialog and server checks), F06 (size one procedure in the placement dialog), then F11 (withdraw a pending procedure request). Codex diffs exist for F05, F02 and F06.
4. P2 slice 3 early-call invitations (`EARLY_CALL_INVITE`, `QUEUE_MOVED`, settings on the three levels).
5. Flutter parity (the slice 2 desk, the live place on the patient ticket): deferred by the owner (2026-11-13). Do no Flutter work until the owner reopens it.
6. F16 offline and network-failure recovery (web built and merged; Flutter parity and idempotency keys remain, Flutter deferred), F15 lighter first load, F07 phone-only sign-in wording, F17 label consistency.
7. P3 voice fallback. OI-05 is decided: the provider is MTN (owner, 2026-11-13). Nothing is built or contracted; check MTN's actual voice and SMS API terms before designing, and keep the provider behind the existing sender seam.

**Business lane account, proposed in addition to its own backlog (it may decline any in `LOG_BIZ.md`; declined items return to the pain lane):** F04 terms and privacy reachable, F13 failed-message follow-up state, F08 clinician report destination, F14 support and demographic-correction destination, F12 quality-programme control, and the web screens for the usage statement and the report comparison (its log says none exist yet).

**Do not touch (pain lane files) without asking in `LOG_PAIN.md`:** `core/queue.py`, `services/booking/queue.py`, `data/sessions.py`, `web/src/staff/Queue.tsx`, `web/src/staff/QueueRules.tsx`.

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
- Languages: English, French and Cameroonian Pidgin (`pcm`) exist (2026-11-13, owner's call). Only the patient web header switcher, Account, Edit details and Home are translated; every other screen, and the Flutter app, is still English. Administrators are web only (ADR 0021).
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

## 8. Current state (updated 2026-11-13, pain lane, appointment Direct Pay)

- PR 38 merged the earlier hosted checkout. Branch `fix/direct-pay-and-queue` carries the follow-up for Fapshi Direct Pay. The patient enters a Cameroon mobile number and approves on the phone. The API takes the visit-day fee, prevents concurrent prompts for the same appointment and verifies the full collection. The desk sees the same record. Development uses the sandbox; production requires an activated service, a separate secret and explicit opt-in. See ADR 0023 and the Fapshi runbook.
- The web desk groups the queue toolbar actions and presents the override beside the hold message on desktop. On narrow screens the action wraps within the banner. The doctor picker names its purpose, and the override still requires a reason.
- Dev still needs fresh credentials in `atria/sandbox/fapshi`, a successful deployment and the stack's API Gateway webhook configured in Fapshi. Browser testing used synthetic data; no actual Fapshi transaction was run. The demo video and Flutter work are deferred by the owner.
- **Dev deploy was broken (fixed on `fix/lambda-policy-size`).** No Deploy succeeded after PR 20: the deploy of 24f2473 rolled `atria-dev-api` back (`UPDATE_ROLLBACK_COMPLETE`) because the booking function's resource policy reached 20,544 bytes, over Lambda's 20,480 limit. `LambdaIntegration` adds two invoke statements per method; main already had 56 on the booking function. `stacks/api.py::proxy_integration` now gives each function ONE invoke statement scoped to the API, and `TestLambdaPolicySize` guards it. PR 36 is merged; merge this next, then run Deploy (owner approves the `dev` environment), or the deploy fails again. Every later Deploy was cancelled as superseded; a stale waiting run was cancelled 2026-11-13.
- Pitch deck (claude.ai artifact "Atria Hackathon Pitch", 17 slides, Atria tokens) and a cost model: `docs/reference/research/atria_cost_model.py`. Finding: AWS is about $30 a month per hospital at list prices; SMS dominates (130,000 to 2.7 million XAF a month by rate and SMS per visit). No SMS, Fapshi or Cameroon software price is verified; the model labels every assumption.
- PR 35 follows PR 34 and includes draft Pidgin wording for early-call invitations and fee notices. Pidgin still needs native-speaker review before patient rollout.
- PR 29 contains the invitation rules and a web fix that clears ripple timers when controls unmount. PRs 30 to 32 build on it.
- Merged to main: PR 20, PR 21 (handoff, reference library, CLAUDE.md, ADR 0022), PR 22 (queue slice 1: `core/queue.py::next_call`, call preview, per-ticket flags, policy routes), PR 23 (business lane B0 to B2), PR 24 (queue slice 2).
- Slice 2 is on main: Desk console: call guard (passes over / held with countdown, "Call anyway" needs a reason), markers (Urgent, Late, Not here yet, Passed over), receptionist-only urgent marking (`POST /appointments/{id}/urgent`, `queue.mark_urgent`, reason required, audited), "Rules for today" (session) and "Queue rules" (unit) dialogs, tenant defaults card in Settings ("The queue"). New route `GET /clinics/{id}/queue-policy`. All three levels are settings, never constants.
- Decision 2026-11-13: only the receptionist marks a ticket urgent. Do not widen it without the owner.
- Fee on the desk (branch `pain/desk-fee`, PR open): `GET /sessions/{id}/queue` adds `fee` per ticket and `walkInFee` (amount in whole currency units and the region currency; 0 is free; null when the type has no fee band), from the band in force on the session date, read once per appointment type (`services/booking/fees.py::FeeLookup`). The desk shows it under each place and in the walk-in dialog. `pain/fee-in-reminders` had not landed when this was built, so `FeeLookup` is the shared lookup and `appointment_fee` in the notify sender should call it after that branch rebases. A fee carries no rating or score and nothing is collected in Atria. The Flutter desk does not show it yet.
- Queue facts the business lane can use for quality metrics without new events: tickets carry `arrivedAt`, `consultationStartedAt`, `completedAt` (consultation length is derived), `bypassCount`, `lateAt`, `urgent`, `urgentAt`.
- P1 built (branch `pain/live-ticket`, from main after PR 24): `GET /appointments/{id}/ticket` (counts and times only, never another patient; `appointment.read` scope; audited as a refreshing read) and the patient ticket screen polls it every 30 seconds: "Ahead of you" and "Likely to be seen around" (estimate from the session's measured consultation length, rounded up to 5 minutes). Core is `core/queue.py::outlook`. The route is `/appointments/{id}/ticket`, not `/tickets/{id}`. The Flutter patient app does not show it yet.
- Fee in reminders built (branch `pain/fee-in-reminders`, PR open): the SMS and email confirmation and reminder carry "Fee: 5,000 XAF" (or "free"; French "Tarif") from the fee band in force on the visit day. Visits whose type has no fee band say nothing. The SMS cancel wording was shortened so a reminder still fits one segment. Owner decisions 2026-11-13: voice and SMS provider is MTN; Flutter work is deferred.
- Slice 3 (early-call invitations), in small PRs on `pain/early-call`: PR 1 pure rules and settings (`invite_targets`, knobs `inviteLeadMinutes`, `inviteFanout`, `inviteOpenMinutes`, `earlyCallInvites` on tenant, unit and session; nothing sends yet). PR 2 notice, outbox trigger and sender (`EARLY_CALL_INVITE`, SMS only, counted by kind in the message log). PR 3 routes: `POST /sessions/{id}/invites` and `POST /appointments/{id}/invite-reply`, `auto` mode runs when the desk queue is read or after a call. PR 4 web: the desk's invite button and chips, the four rules in the session and unit dialogs and in tenant Settings, Yes or No on the patient's ticket. Flutter is not done (label map in `oversight.dart` still lacks the kind).
- Codex is no longer on the project (2026-11-13). Its unfinished worktrees are not merged and not verified; section 1 says how to adopt them.
- Not built yet (pain lane, in order, section 1): fee in reminders and local-language messages, audit F05, F02, F06, then slice 3 early-call invitations (`EARLY_CALL_INVITE`, `QUEUE_MOVED`, settings on the same three levels).
- Offline and network-failure recovery (audit F16, web only, branch `pain/offline-recovery`): failed requests are classified and worded in `web/src/api/failure.ts`; `client.ts` retries only GETs, never writes, and flags a write whose outcome is unknown; `network.ts` holds the connection state and `startPolling` (pauses offline and in a hidden tab); `ConnectionBanner` is in both shells; booking, join queue, procedure request and the new-time offer keep what the person chose and say whether it went through. Not built: offline shell or queued writes (owner decision), idempotency keys beyond `POST /appointments` (backend), F15 route splitting (recorded in `LOG_PAIN.md`), Flutter parity.
- Live dev app: `https://main.dym1ejjx8bhtw.amplifyapp.com`. SMS and email are in AWS sandbox (OI-04): no real patient receives a text yet. The SRS permission matrix PDF does not list the new queue permissions.
- Language options (branch `pain/language-options`, pain lane, taken from Codex X2 because Codex had not started): `pcm` added to the Cameroon region pack (`spec/`), `notices.OFFERED` now `("en","fr","pcm")`, `language_for` fixed (it cut `pcm` to `pc`), Pidgin wording in `core/pidgin.py` merged into notices, SMS and Cognito emails. Web: `react-i18next`, `web/src/i18n/` (locale JSON per language and namespace, `LanguageProvider`, header `LanguageSwitcher`), choice saved with `PATCH /me`. Translated screens: Account, Edit details, Home. **All Pidgin text is a draft and needs a native speaker's review before real patients see it.** Not done: other patient screens, staff screens, Flutter app (its chooser exists, strings are English; Flutter has no `pcm` locale), landing pages, per-tenant template additions (FR-REM-10). Full CI set and screenshots by the owner's request were not run by the lead session; sub-sessions ran web typecheck, tests and build only.
- Open audit findings relevant to the business lane: F08 (clinician report destination), F13 (failed message follow-up state).

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

## 13. Business lane status (updated 2026-11-13 by the business account)
Full detail in `docs/handoff/LOG_BIZ.md`. Branch `biz/usage-statement-and-baseline`, uncommitted: the owner decides when to commit, push and open the PR.
- B0 ADR 0030 written (proposed). **Owner decision needed** before B3. Nothing commercial is built.
- B1 done: `GET /messages/usage` (ADR 0031) and an administrator Usage tab on Messages. Possible next: a CSV through `utils/export/`, once the owner wants it.
- B2 done: F18 fixed, `before` comparison on both report endpoints, and a Compare picker with change lines on the Reports tiles. Queue-quality measurements are in the report (branch `biz/queue-metrics`, needs PR 26 first); they need no new event, and measure against the window as last told because the first is not kept. The comparison is also in the PDF, Excel (a Comparison sheet) and CSV exports.
- B4 done: the "Set up a unit" checklist at `/console/onboarding`. B3 is not started and is blocked on the owner approving ADR 0030.
- Owner rule recorded: the text in a pill (`.chip`) is always centred.
- Setup note: a venv inside OneDrive failed with permission errors. Build it outside the synced folder.

## 12. Queue revision: what it changes for the business lane (from ADR 0022)
- **B1 metering:** new message kinds `EARLY_CALL_INVITE` and `QUEUE_MOVED` will appear in the message log. Count them by kind per unit. They are time critical, so delivery speed matters more than for reminders.
- **B2 baseline report:** add queue-quality metrics next to attendance: doctor idle minutes, arrival-to-consultation wait, promise breach minutes (consultation start minus window end for patients who arrived in their window), bypass rate, on-site versus online mix. Consultation length is derived from the existing `consultationStartedAt` and `completedAt` stamps on the ticket; no new event. State them as measurements only, never as currency savings (FR-MSR-04, CX-12).
- **Settings are not plan tiers.** `queueHoldMinutes`, `queueLateGraceMinutes`, `queueMaxBypass` (and later the invitation settings and a possible walk-in reserve share) are configuration set by tenant, unit or session. Do not attach them to pricing before B0 is decided.
- **Coordination:** the pain lane owns `core/queue.py`, `services/booking/queue.py` and the ticket fields. The business lane reads them; if you need a field, ask in `LOG_BIZ.md` and let the pain lane add it so the two do not edit the same files.
