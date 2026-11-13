# Reference material

Project documents that used to live outside the repository. Read what the task needs; do not load PDFs wholesale.

| Path | What it is | Use it for |
| --- | --- | --- |
| `specifications/ATR-SRS-001_...pdf` | Software Requirements Specification, Rev B | Requirement ids (FR-, NFR-, CX-, AD-), phases, scope. FR-TEN-03 and FR-MSR-07 bound the business lane. |
| `specifications/ATR-TD-001_...pdf` | Technical Document, Rev B | Architecture, key tables, routes (section 9), UML and AWS diagrams, decisions AD-01 to AD-13. |
| `specifications/ATR-DS-001_...pdf` | Design Specification, Rev B | Screen specs and UI images. 16 MB: search it, do not read it end to end. |
| `design-system/atria.tokens.json` | Colour, type, radius tokens | Source of the document and export look. Web uses `web/src/styles/tokens.css`; exports use `web/src/utils/export/tokens.ts`. |
| `design-system/document-builder/` | `atria_doc.py` (HTML to A4 PDF in the Atria house style via headless Edge) and `atria_docx.py` | Producing any report PDF. House style: ground #E9F0FD, Outfit headlines, white rounded tables, glass callouts, IBM Plex Mono footer. |
| `research/Atria_Hospital_Evidence_Report.pdf` | 56 page evidence report with a 379 source register | Pitch claims and what may not be claimed. Mixed evidence on reminders. |
| `research/Atria_Pitch_Flow_Map.pdf` | Pitch flow map for the three pain points | The pitch running order and numbers safe to say. |
| `reviews/2026-11-04/AUDIT.md` | Product audit with findings F01 to F18 | Backlog. Screenshots were left out (public repo); links to `evidence/` are broken on purpose. |
| `WORKING_RULES.md` | The owner's working rules as Markdown | How to work. Also summarised in the root `CLAUDE.md`. |

The repository is public. Never add credentials, account or pool identifiers, staff import workbooks, credential PDFs, or
screenshots of real records here (constraint C-03 and CONTRIBUTING.md).
