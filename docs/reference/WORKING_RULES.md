# Working rules for Atria

Converted from the owner's "Atria working rules" document (compiled 2026-09-30) so an AI session can read it in the repo.
AWS account numbers, pool identifiers, device serials and sign-in details were left out on purpose: this repository is
public. Items marked (STALE) were true on 2026-09-30 and have since changed; the current rule is given.

## 1. Non-negotiables
- No em dashes, anywhere: prose, docs, code comments, commit messages, UI copy. Use periods, commas or parentheses.
- No AI attribution in commits or PRs: no Co-Authored-By, no "assisted by", no "generated with". Conventional commits.
- Never type real passwords into any form. Demo test values on local development builds are fine.
- Never create accounts on non-local services unless the owner tells you to for a named purpose.
- Run the full CI check set before every push, then watch CI and Deploy to green. A push is unfinished until both pass.
- Administrators stay web only (ADR 0021). The app serves patients and staff.
- English only in everything a person sees until the language-switching phase.

## 2. How to work with the owner
- Think. Find the root cause; what the owner lists are symptoms.
- Work screen by screen: look, diagnose, change, screenshot, move on. A bulk contrast pass once altered 2,648 paints across
  94 screens and the owner said: "I'm tired of you mass fixing something and then destroying something else."
- Fix platform-wide when the rule is a platform rule (loaders, buttons, overflow), then simulate every workflow.
- Ask before any change that alters rendered pixels across many screens.
- Keep the owner posted during long work with a few words on what is happening.
- Report faithfully: what was verified and how, what was not, why. Show failures.
- Run long suites in the background. Do not spawn large agent fan-outs (a 14 agent audit burned 904,000 tokens in minutes
  and returned nothing). Work sequentially or two or three at a time.
- When the owner approves a design, build the rest. For redesigns, build a few screens first and wait for approval.
- Do not revert what was already ported unless asked.

## 3. Safety and permissions
- Ask before downloading files. Do not change system settings on the owner's PC or phone. Do not bypass PowerShell policy.
- Real sign-in is the owner's to test. Verify screens through the dev preview (`/__preview`) and demo builds.
- Synthetic data only in development. Test phone numbers are fictional (+1 ... 555 01xx). The deployed dev app now also
  holds real patient accounts: read only, never book, cancel or edit them.

## 4. Git, CI and deployment
Run exactly what CI runs before every push:

| Job | Commands |
| --- | --- |
| Backend | `ruff check spec backend`, `ruff format --check spec backend`, `mypy`, `pytest --cov-fail-under=85` |
| Spec | `python spec/generate.py --check` |
| Infra | `ruff check .`, `ruff format --check .`, `mypy .`, `pytest`, `npx aws-cdk@2 synth` (in `infra/`) |
| Flutter app | `dart format --output=none --set-exit-if-changed lib test`, `flutter analyze`, `flutter test` |
| Web | `npm run format:check`, `npm run typecheck`, `npm test`, `npx vite build` (in `web/`) |

- Watch CI and Deploy with `gh run list`. Deploy runs after CI passes on main and waits for the `dev` environment reviewer.
  Only one Deploy runs at a time: a stale waiting run blocks newer ones, so cancel superseded runs.
- Deploy publishes the web client (`tools/web_env.py` then `tools/deploy_web.py`). Amplify is not git connected; it takes a
  zip upload. Confirm SUCCEED in the Deploy log. A dropped upload leaves a PENDING job that blocks deployments:
  `aws amplify stop-job`.
- (STALE) "Feature work is committed to main." Current rule: branches and pull requests (CONTRIBUTING.md); the owner merges.
- Commit from the OneDrive repo even when building from an unsynced copy.
- CI pins Flutter 3.47.5. Move it deliberately, together with the migration off `package:flutter/material.dart`.

## 5. Verifying work
- Screenshot every new screen at 1280x720 and on a phone before reporting it.
- Prefer measurements to screenshots in the preview: the tab is often hidden and throttled. Use DOM measurements.
- Vite on OneDrive can serve a stale file after multi-step edits: touch the files and reload.
- App workflows are tested with integration_test tours on a real phone, not screenshot then tap. Test release builds on a
  device (debug builds hid a missing INTERNET permission).
- Check nothing paints over button labels and no card overflows at any size.

## 6. Design language (all clients)
- Rev A is signed off: glass with a Material 3 Expressive feel. Prefer additive change; add tokens rather than snapping
  or consolidating colours. Appearance beats system purity; record divergences.
- Only redesign what behaviour forces. Screens that just display data keep their layout.
- Never default ink to brand blue; an element with no hue of its own uses neutral ink. Admin identity is purple (#8B5CF0
  family); patient and staff are blue.
- Build new screens from existing parts: `.input`, `.suggest`, `.filter-menu`, Find care day and slot chips,
  `.outline-button`, `.tonal-button`. One filled primary per action group.
- Destructive batch actions use red glass, not a red fill. Status chips: the status hue at 0.11 to 0.18 opacity over white.
- Notification counts are Material 3 large badges: 16px high, 11px medium numerals, error colour, flat, nav icon top right.
- Every busy action shows the M3 Expressive loading indicator; loading lists centre it in the card.
- Buttons side by side align. No overflow at any size. Scope every style to its component (an unscoped `.map-route` once hid
  another screen's line).
- Dialogs: an x close top right on a white backing; long content scrolls inside with a slim rounded bar and faded edges;
  actions pinned below.

## 7. Motion: Material 3 Expressive (ADR 0019)
- Nothing is static. Spatial springs for movement, effects springs for colour and opacity.
- Pressables have a state layer, shrink slightly and tighten corners while held, then spring back.
- Entrances rise in or slide on a shared axis; honour reduced motion.
- App spring values: fast spatial damping 0.6 stiffness 800 (350ms); default spatial damping 0.8 stiffness 380 (410ms);
  effects critically damped 140 to 300ms. Screens rise 12px in 30ms steps (at most six). Earlier 600ms rises were "slow and tacky".
- Nothing moves behind glass every frame in the app; glass cards share one backdrop pass per screen.
- Keep spring overshoot out of opacity.

## 8. Web interface conventions
- Filters never list every option: "All" plus three or four popular ones that fit on one line, then "N more"; the filter
  button opens a menu (a sheet on phones) with every option and its count. Chip rows never wrap (`FilterMenu.tsx`).
- Search guesses as you type, grouped by category, forgiving case, accents and one typo (`SearchSuggest.tsx`).
- Lists page, never infinite scroll: search, filter chips and `Pager.tsx`. (STALE) page size "rows that fit"; now
  `PAGE_ROWS = 50`. Lists fill the space before paging.
- Deletable lists offer page-wide selection (`Selection.tsx`): a box per row, a header box, "N selected" with red glass Delete.
- No browser-native controls: no native select, checkbox, date or time input. Use `Pickers.tsx` and the platform checkbox.
- Phone fields use `PhoneField.tsx`; date of birth uses `BirthDateField`. Add to calendar offers Google, Outlook, Apple or .ics.
- Info bands only where they add something. Controls whose label width changes get a fixed width.

## 9. Layout and scaling
- Zoom by width only: the canvas is 1440 wide (tablet 1194); height only adds room. Measure at 1280x551 and 1280x720
  using `documentElement.clientWidth`.
- Three tiers: desktop 1200 and up, tablet 768 to 1199, mobile under 768. Tier layouts live in `tiers.css`, loaded last.
- Sign-in pages keep a 760px minimum height and scroll on short windows.

## 10. Mobile app
- Workflow parity, not screen parity: every web workflow is doable in the app on phone and tablet, in the app's own design.
- Onboarding keeps its deep blue redesign. (STALE) The Rev C app proposal was awaiting approval and is NOT approved: never
  build from it. Other app screens follow the Rev A Figma.
- Email links open the app (Android App Links for `/visits` and `/queue`, checked against `web/public/.well-known/assetlinks.json`).
- Release builds need the INTERNET permission in the main manifest. Sign-in never fails silently.

## 11. Product and domain rules
- General consultations are a session queue shown as a place and an arrival window ("Outpatient queue, place 15", "Arrive
  between 10:22 and 10:52"). Never lead with a big queue number. A doctor is assigned at check-in. Web and app match.
- Specialist visits are booked by time with a named clinician. Procedures are requested by patients and placed by staff.
- Waits read in minutes only below an hour, then hours and minutes, then days.
- Ratings never change a fee in Cameroon (ONMC code; the Cameroon region pack refuses the tenant flag).
- Wording: clinics are "units", the organisation is the "healthcare institution"; the tenant is the Regional Hospital of Buea
  (hypothetical). "Refund", never "entitlement", where a person reads it.
- Region: Cameroon, XAF, +237, Africa/Douala. Development in us-east-1 on synthetic data (Law No. 2024/017).
- Four staff roles plus the patient: receptionist, clinician, unit manager, tenant administrator.
- Check a requirement's SRS phase before proposing work, and sequence by phase.
- Python for everything on AWS (CDK included), TypeScript only in `web/`, Dart in `app/`. `spec/` is the single source.

## 12. Diagrams and documents
- Diagram connectors run at 90 or 180 degrees, never crossing; labels sit in separate text blocks beside lines. Correct UML
  notation only. Validate geometry and look at an exported image before calling a diagram done.
- Documents are styled like the Atria platform, not plain Word: see `docs/reference/design-system/`. Reports for the owner
  are PDFs in that style, not Markdown.
- Every PDF, Excel and CSV export follows the same style through `web/src/utils/export/`.

## 13. Environment gotchas (Windows)
- Use the repo `.venv`; quote paths with spaces; for `cdk synth` put `.venv/Scripts` first on PATH.
- Android builds fail inside OneDrive: build from an unsynced copy, commit from the OneDrive repo.
- Flutter may need a drive alias without a space in the path (the SDK path has a space that breaks hooks).
- Set `MSYS_NO_PATHCONV=1` for `/aws/lambda/...` log commands in Git Bash.
- If `infra/build` reports "Access is denied", delete it and retry. Never trust `cdk.out` after a plain `python app.py`.
- Preview: `http://localhost:5173/__preview?as=patient|receptionist|clinician|manager|admin&at=/path` against the mock API.

## 14. Open items from the source document
Rev C app screens await approval; remind the owner at the start of Phase 3 to redesign the sign-in pages for short
windows; mobile push needs a Firebase project the owner creates; phone orientation is undecided; tablet testing of the app
is still to do; SMS codes for verifying a changed mobile are not built; the 2026-09-29 email reminder test was never confirmed.
