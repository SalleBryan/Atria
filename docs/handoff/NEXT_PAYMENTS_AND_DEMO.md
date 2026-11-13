# Fapshi payments and demo handoff (2026-11-13)

Current update: PR 38 was already merged when this handoff was picked up.
The Direct Pay follow-up and queue fixes are on `fix/direct-pay-and-queue`.
For setup and testing, use the [current Fapshi runbook](../runbooks/fapshi-sandbox.md).
The owner deferred recording the video and all Flutter work. The original
handoff below records the prior state and the future video brief.

The pain lane account is out of capacity. The owner asked the other Claude account to finish these. Read `CLAUDE.md`, `HANDOFF.md` and this file first. All the usual rules hold: no em or en dashes, no AI attribution, never push to main, full CI set before every push, update `HANDOFF.md` section 8 and your lane log before every push, report what you did not verify.

## Where things stand

- **Dev deployment is fixed and green.** PR 37 (one API invoke permission per function, so the booking function's Lambda resource policy stays under 20,480 bytes) is merged; Deploy for `e205655` succeeded, `atria-dev-api` is `UPDATE_COMPLETE`, Amplify job 31 succeeded, the live landing page loads with no console errors. A stale Deploy run waiting for approval blocks newer ones: cancel the stale one, then approve the newest.
- **PR 38** (`feat/appointment-payment-sandbox`) is open, Auto-fix was on in the pain lane session. It includes the owner's earlier commit `91c6ec6` (Fapshi admin test checkout) and the appointment payment.
- Pitch deck: claude.ai artifact "Atria Hackathon Pitch" (redesigned to 8 slides by a separate session). Cost model: `docs/reference/research/atria_cost_model.py`.

## Owner decisions (2026-11-13, binding)

1. **Treat Fapshi as a real payment integration**, configured per environment the way SMS is: sandbox host in dev, live host in production. Do not label it "sandbox" or "test" in the patient or desk UI. (Internal module names `payment_sandbox` may stay for now; renaming is optional and large.)
2. **The payer gives a phone number and Fapshi sends the prompt to that phone** (Fapshi direct pay, `POST /direct-pay`).
3. **The amount is locked to the visit's fee**, not hard-coded: the fee band in force on the local day of the visit (`services/booking/fees.py::FeeLookup`). A 1,500 XAF consultation is charged 1,500 XAF. The client never sends an amount; any it sends is ignored.
4. The demo video must be faster, longer on the patient-facing pain point features, and 2:32 to 2:50 long (see below).

## Done in the last commit on PR 38 (backend and infra, tested)

- `backend/src/atria/services/payment_sandbox/fapshi.py`: `host()` from `FAPSHI_HOST` (only `sandbox.fapshi.com` or `live.fapshi.com`), credentials must match the host (test key only on sandbox, live key only on live), `mobile_number()` (Cameroon mobile, 9 digits starting with 6; strips spaces, dots, dashes, `+237`), `masked()` (only the last three digits are stored or shown), `Fapshi.direct_pay(reference, amount, phone, message)`; the amount is a parameter everywhere (admin test checkout keeps 500).
- `appointment_payment.py`: `POST /appointments/{id}/payment` body `{"attemptId": "<uuid4>", "phone": "6XXXXXXXX"}`. Amount from the fee band; 409 for no fee, free, cancelled, under Fapshi's 100 XAF minimum, already paid, or a prompt still waiting on a phone (Fapshi has no idempotency: a second request sends a second prompt, so never resend; a lost answer is recovered by reference via `GET /transaction/{userId}`, which `_status` already does). Status starts `PENDING`; `GET` refreshes from `/payment-status/{transId}` and `paid` is true only for `SUCCESSFUL` with the exact amount. View fields: `status`, `paid`, `amount`, `currency`, `attemptId`, `transId`, `payerPhone` (masked), `startedAt`. The `sandbox` field and `checkoutUrl` were removed from this view.
- `spec/atria_spec/payment_sandbox.py`: `HOST_ENV`, `HOSTS`. `infra/atria_infra/config.py::fapshi_host` (production live, else sandbox), passed as `FAPSHI_HOST` to the function.
- Tests: `backend/tests/services/test_appointment_payment.py` (direct pay, locked amount, `+237` numbers, bad number refused, no double prompt, already paid, no fee, cancelled, other patient, other unit, test key refused on live, unknown host refused) and the infra payment tests pass. Backend ruff, format, mypy clean.

## Original follow-up checklist

1. **Web** (`web/src/components/SandboxPayment.tsx`, its test, `web/src/dev/mockApi.ts`):
   - Patient (`PayFee`): replace the hosted checkout with a phone field (reuse `web/src/components/PhoneField.tsx` if it fits Cameroon numbers, else a plain input styled like `.input`), a button **Pay 1,500 XAF with mobile money** (the amount from `GET`, shown, not editable), then **Approve the payment on your phone. We sent a prompt to 6.. ... 123.** and poll `GET` every 5 seconds (use `startPolling` in `web/src/api/network.ts`, which pauses offline) until `paid` or `FAILED`; on failure offer to try again. Remove every "sandbox", "test payment" and "No real money moves" wording.
   - Desk (`FeePayment`): "Paid in full, 1,500 XAF by mobile money (6.. ... 123)" or "Not paid, 1,500 XAF owed" or "Waiting for the payer to approve"; drop "Fapshi sandbox, test money".
   - Mock: POST requires `phone`, returns `PENDING` with `payerPhone`; the first GET after it returns `SUCCESSFUL`. Keep payments in `sessionStorage` (`atria.preview.payments`) so the desk persona sees them.
   - Update `SandboxPayment.test.tsx` to the new flow.
2. **ADR 0023** (pain lane number range; or 0032 if you file it as business lane): patients may pay the visit fee by mobile money through Fapshi direct pay; supersedes ADR 0007's "Atria moves no money" for this flow; amount from the fee band; fee ledger untouched for now; Fapshi takes 3% of each collection (verified in Fapshi's payment-status docs: `revenue` is the amount after the 3% fee); live direct pay needs Fapshi's activation review and is not available to aggregators. Update `docs/openapi/atria.yaml` (`/appointments/{id}/payment`: request now has `phone`, response has `payerPhone`, no `checkoutUrl`/`sandbox`) and `docs/runbooks/fapshi-sandbox.md`.
3. **Deck**: the deck still says "Atria moves no money" and gives the Fapshi fee as 0.5% to 3.5%. Change to: patients can pay the fee by mobile money; Fapshi's fee is 3%.
4. **Full CI set**, update `HANDOFF.md` section 8 and your log, push to PR 38. Then the owner merges and approves Deploy.
5. **Real payment test** needs the owner to store the secret `atria/sandbox/fapshi` in Secrets Manager (`apiuser`, `apikey` from the Fapshi sandbox tab, `webhookSecret`), see the runbook. Use Fapshi's test numbers: MTN `670000000` succeeds, `670000001` fails. Never type real credentials.

## The demo video

Script: `tools/demo/record_demo.js` (Playwright, records the dev preview at 1920x1080 with a drawn cursor, chapter labels and opening and closing cards). The last take is `Atria demo - pain points.webm` (2:49) in the owner's project folder.

Setup on the owner's PC: `playwright-core@1.59` is installed in `C:/Users/Bryan/atria-wt/rec` (run the script from there: `node record.js`, or copy `tools/demo/record_demo.js` there). The Chromium used is `%LOCALAPPDATA%/ms-playwright/chromium-1234/chrome-win64/chrome.exe` (already installed); the video encoder is Playwright's `ffmpeg-1011`, which writes WebM (VP8) only. Start a preview server for the branch first (`.claude/launch.json` entry `atria-pay-web`, port 5193; the worktree needs `web/.env.local` with placeholder values, never real pool ids).

What the owner asked for next:
- **Faster cursor.** `glide()` defaults to 650 ms; try 350 to 400 ms. `PACE` (now 0.45) scales the holds.
- **More time on patient-facing pain point features, including the slot lock**: book a specialist time (`/find-care`, pick a clinician and a free time; a taken time is never offered and two people cannot book the same grid unit, see `data/booking.py::locked_units` and the conflict path in `services/booking/appointments.py`), the live ticket, the fee before booking, the language switch, offline recovery, the new mobile money payment with a phone number, and the desk confirming it. Keep the desk scene (guard, held doctor, Call anyway, urgent) shorter.
- **Length 2:32 to 2:50.** The video runs about 14% longer than the script's own clock; the last take printed 146 s and the file was 2:51. Measure the file with `ffmpeg -i`.
- The "doctor is held" state depends on the real clock in the mock queue; the script already checks for it before using it.
- Pain lane rules on screenshots: synthetic data only; never record the deployed app with real patient accounts.
