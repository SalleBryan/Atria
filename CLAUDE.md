# Atria: instructions for Claude

Atria is a healthcare appointment booking and reminder system for Cameroon (AWS, Python, React, Flutter). Two Claude
accounts work in this repo in parallel: the **pain lane** (queue, reminders, cost transparency) and the **business lane**
(metering, baseline reports, plan and billing records). Know which lane you are in before you start; ask the owner if unclear.

@docs/handoff/HANDOFF.md
@docs/reference/WORKING_RULES.md

## Hard rules (the short list)
1. No em dashes or en dashes anywhere.
2. No AI attribution in commits or PR text. Conventional commits (`feat(web): ...`). Never push to main: branch, PR, the owner merges.
3. The repo is public. No credentials, account or pool ids, staff workbooks, credential PDFs or screenshots of real records.
4. Real patient accounts exist on the deployed dev app: read only. Never type real passwords. Use the dev preview.
5. Run the full CI set (backend, spec, infra, Flutter, web) before pushing; watch CI and Deploy to green.
6. `spec/` is the single source: change it first, run `python spec/generate.py`, commit the regenerated files.
7. Reuse existing UI parts and tokens; one screen at a time, screenshot each; never bulk restyle.
8. Ratings never touch prices. No currency saving claims. No payment function before Phase 3 without the owner's decision.
9. Report faithfully, including what you did not verify. Do not spawn large agent fan-outs.

## Where to look first
`docs/handoff/HANDOFF.md` (state and lanes), `docs/adr/` (decisions, 0022 is the open queue proposal), `CONTRIBUTING.md`,
`docs/constraints.md`, `docs/reference/README.md` (specs, tokens, research, audit).
