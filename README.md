# PReBi Evaluator Guide

## G1 feedback generation (developers)

The standalone G1 workspace is available at `?workflow=g1`. The default expert
evaluation and its stored data remain separate. Paste a German reflection;
a period followed by a line break divides segments. Periods without a following
line break and line breaks without a preceding period do not split the text.
Common abbreviations (such as `z. B.`, `d. h.`, `Dr.` and `usw.`) and
decimal numbers are protected heuristically; the heuristic is not a full
sentence tokenizer and may keep a sentence-ending abbreviation with the next
line. Review the displayed boundaries and edit the input before confirming.
Leading and trailing whitespace is removed from each segment. The generated
segment IDs are used for evidence references; boundaries may affect research output.

The local service sends the reflection to Google Gemini. Only use material
approved for external processing, and explicitly confirm that authorization.
The output is model-generated and requires human review. Neither the input nor
the result is persisted by this workspace; download the original response JSON
before leaving. The response itself does not include the input reflection,
feedback letter, or provenance. Handle downloads as potentially sensitive.

Run the standalone service as described in
[`prebi-g1-backend/README.md`](../prebi-g1-backend/README.md), then start the
UI with `npm run dev`. By default Vite forwards `/api/g1/*` unchanged to
`http://127.0.0.1:8000`. The existing lecturer `/api/*` proxy continues to
strip `/api`. If both distinct backends are needed concurrently, run G1 on a
different port and start Vite with, for example,
`PREBI_G1_BACKEND_URL=http://127.0.0.1:8001 npm run dev`.
The Vite proxy is development-only; preview or production hosting needs
equivalent same-origin routes and an appropriate access policy. Never expose
the unauthenticated G1 service publicly or put provider keys in the frontend.
Generation requests are not retried automatically: a timeout or disconnect
does not guarantee that the provider stopped processing or billing.

## Lecturer workflow demo (developers)

The existing evaluator remains the default. A separate **synthetic-only**
lecturer workspace is available at `?workflow=lecturer`:

```bash
npm run dev
# Open http://127.0.0.1:5174/?workflow=lecturer
```

It demonstrates preparation of a fixed fictional reflection, SW/UA/HA rating,
explicit sequential G1/G2 simulation, required preference (including tie or
neither), editing with evidence, and human-reviewed approval. Use the labeled
G2 failure switch to exercise partial failure and explicit retry. The successful
candidate is retained. Pending work restored after a reload is marked
interrupted/unknown and is never automatically retried.

**This demo mode does not ingest PDFs, call an API/provider, supply an approved
rubric, export student reports or deliver feedback.**
Do not use real student material. Its read-only rubric and predictions are
illustrative, not the approved research scoring protocol.

Confirmed ratings can be reopened after a warning; doing so clears both
candidates, comparison, draft and approval history. Changing preference retains
the draft, requires explicit reconfirmation and makes previous approvals stale.
Draft edits also stale approval; originals and past approval snapshots remain
unchanged. Starting from G1/G2 or an empty draft is independent of preference.
Unlinked items warn for human review; invalid/duplicate evidence references and
empty feedback at approval are rejected.

Exactly one demo case is saved in a distinct IndexedDB namespace
(`lecturer-workflow::synthetic::v1`). Autosave requires IndexedDB and Web Locks
on a secure context (localhost qualifies). Save failures and multi-tab conflicts
are surfaced without overwriting conflicting work. Export before closing if
saving fails, then reload to read the current local version. Unknown/corrupt
versions are not silently migrated: explicitly restore a valid backup or delete
the local demo case. Session backup/restore accepts only the new
`prebi_lecturer_workflow` schema `1.0.0`, with a 5 MB UTF-8 backup limit enforced
on imports and session changes so accepted work remains restorable; it does not
migrate existing research/review sessions. Backups contain the whole session,
not student-ready feedback. Browser storage is not private or guaranteed durable;
export needed work before clearing it and delete demo data on shared devices.

Implementation entry points:

- [`src/LecturerWorkbench.tsx`](./src/LecturerWorkbench.tsx): five-step UI.
- [`src/lecturerSession.ts`](./src/lecturerSession.ts): runtime validation,
  workflow gates, provenance, invalidation and immutable snapshots.
- [`src/lecturerService.ts`](./src/lecturerService.ts): injectable synthetic
  service; generation receives prepared data, condition and attempt ID, never
  lecturer ratings. The `LecturerWorkbench` service prop is a testing seam,
  **not** an approved HTTP contract.
- [`src/lecturerPersistence.ts`](./src/lecturerPersistence.ts): queued,
  conflict-checked persistence using the existing storage helpers.

Run `npm test` for domain/persistence tests and existing research regressions,
and `npm run build` for type-checking and a production build. Browser checks
were performed using the VS Code browser tools; no browser test runner was added.
Real API integration and real-data readiness remain separately gated.

## Local lecturer API integration (developers)

Open `http://127.0.0.1:5174/?workflow=lecturer&source=api` after `npm run dev`.
The existing demo and evaluator routes remain unchanged. This opt-in integration
is for **synthetic test data only**, not authorization to use real student data.

Run a compatible backend separately on `127.0.0.1:8000`. Vite proxies `/api/*`
to that loopback service, stripping `/api`; no browser CORS change is needed.
Vite's proxy is development-only: production/preview hosting needs its own
same-origin `/api` routing and approved access policy. No credentials or provider
keys belong in the frontend.

The API mode:

- Fetches `GET /v1/rating-materials` and uploads a selected nonempty PDF
  (maximum 10 MiB) via multipart `POST /v1/preparations`. Client checks are
  preliminary; the server must validate PDF contents.
- Uses the server's scoring guide, including anchors and half-score guidance.
  Stores rubric/guide identities, versions and hashes, preparation locations,
  original segment order, scope and prediction labels. Out-of-scope `N` is
  displayed distinctly from band zero.
- Requires confirmed lecturer scores and an explicit, non-persisted
  external-generation confirmation before sequential G1/G2 requests.
  Generation sends the prepared document, rubric binding and opt-in; G2 also
  sends predicted analysis. Scores, preference, edits, and derived summaries
  are not sent. Server-side provider authorization is still required.
- Validates response shapes, document/rubric binding, dimensions and evidence
  before accepting a candidate. Preserves full structured output, letter and
  provenance as well as deterministic candidate-scoped feedback items.
- Keeps successful candidates when another request fails. Retry is explicit.
  Requests have a 120-second client deadline and a 5 MB response limit. A
  disconnect/deadline does not prove a provider operation stopped or was not
  billed. Late/obsolete results are ignored by the existing attempt gates.

API sessions use schema `1.1.0` and IndexedDB key
`lecturer-workflow::api::v1.1`, separate from demo schema `1.0.0` and its storage.
Backups retain the complete sensitive session, not the uploaded PDF. Wrong-mode
backups and inconsistent/tampered projections are rejected, not migrated.
These consistency checks do not authenticate unsigned browser-held predictions
or approvals. The existing 5 MB backup limit also applies to API sessions.
Generation confirmation must be renewed after reload, restore or replacement.

Implementation: [`src/lecturerApi.ts`](./src/lecturerApi.ts). Adapter tests inject
`fetch` and use synthetic HTTP responses, including partial failure/retry;
`npm test` and `npm run build` validate the frontend without a backend/provider.
The backend's injected TestClient services are not a runnable synthetic server:
provision a development-only synthetic server separately for real HTTP E2E work.
Do not silently substitute synthetic results when a real backend fails.

Known backend dependencies: safe preparation-error HTTP mapping, deployment
authentication/data policy, resource limits, and model provisioning remain
separate work. Student PDF export remains unavailable.

## Research evaluator

The app opens the blinded PReBi expert evaluation. Use the link, evaluator ID
and bundle file provided by the research team. You do not need to install
anything or create a GitHub account.

## Quick start

1. Open the app link and enter your **Pseudonyme Bewertungs-ID** (see
   [Evaluator ID](#evaluator-id-coder-id)).
2. Select **Evaluationspaket öffnen** and choose the bundle provided for you
   (for example `E01.json`).
3. Work through the reflections as described below. Your work saves
   automatically; you can pause and resume.
4. When finished, select **Bewertungen exportieren** and send the file using
   the secure method provided by the research team. The app never sends data
   automatically.

## Workflow per reflection

Each case shows the reflection, the human segment annotation (skill label and
Band A/B/C), and descriptive segment statistics (no average score).

**0 · Referenzbewertung** – Score the reflection itself on SW, UA and HA
before any feedback is shown:

- a required score from 0,0 to 3,0 in steps of 0,5 (rubric anchors shown);
- an optional **Kommentar (optional)** per dimension.

The guidance follows reference-score protocol
[`reflection_reference_score_human@0.2.0`](../prompts/reflection_reference_score/human/0.2.0.md),
which is embedded in the bundle. Confirming the three scores locks them and
unlocks the feedback steps, so the generated feedback cannot influence the
reference score.

**1 · Freigabebereitschaft** – For each of the three feedback candidates (A, B, C), choose
**Ohne Änderungen freigeben**, **Nach Bearbeitung freigeben**, or **Nicht
freigeben**. An optional explanation field appears for edit and reject
decisions. Evidence references in each feedback statement link back to the
relevant reflection segment.

**2 · Paarpräferenz** – Compare A–B, A–C and B–C, choosing the first candidate,
the second candidate, or **Keine wesentliche Präferenz**. A tie is an explicit
answer, not a missing one.

A case is complete after the confirmed reference scores plus the six feedback
choices (9 entries). You can revisit cases and change release and preference
answers; locked reference scores cannot be changed.

## Evaluator ID (coder ID)

The evaluator ID you type on the start page is the coder ID for your whole
session. It is not stored in the bundle, so the app cannot check it against
the bundle file name.

- **Use the ID that matches your bundle**: enter `E01` for `E01.json` and `E02`
  for `E02.json`. The ID is written into the session backup and the research
  export, and the analysis attributes your answers to it.
- **Type it exactly the same every time.** Autosaved work is stored under the
  ID together with the bundle checksum. IDs are case-sensitive (`E01` ≠ `e01`).
  Another ID, or a different bundle file, opens a new empty session instead of
  your saved work.
- **Session backups are bound to the ID.** **Sitzungssicherung
  wiederherstellen** only accepts a backup when the same ID is entered.
- The ID must be 1–64 characters (letters, digits, `.`, `_`, `-`; no spaces).
  Use only the pseudonymous code, never your name.
- Each expert works in their own session under their own ID. The two experts'
  reference scores are exported and analysed separately and are never averaged.

## Pause, resume and backups

Work autosaves in the browser on the device you are using. To resume, open the
same link, enter the **same evaluator ID**, open the **same bundle**, and choose
**Fortsetzen** if asked.

To protect your work or move to another device, select **Stand exportieren**
to save a session backup. On the other device, enter the same ID and use
**Sitzungssicherung wiederherstellen**. A backup contains the bundle and all
partial answers; it is not the final ratings file.

Do not clear browser data before exporting your ratings. If the app reports
that saving failed, export a session backup before closing the page.

## Research export

**Bewertungen exportieren** produces the file for the research team. It
contains the evaluator ID, completed cases with reference scores (optional
comments and confirmation time), release decisions, pairwise choices
(including explicit `tie` values), the A/B/C display order, timestamps,
protocol/schema versions, and the input bundle's SHA-256 checksum. Partial
sessions are marked `in_progress` and include completed cases only.

## Blinding

The A/B/C order is fixed in each evaluator's bundle and stays the same when a
session is reopened. The mapping from candidates to experimental conditions is
kept separately by the research team. Bundles that contain conditions,
judge/model identifiers, historical lecturer feedback, reference concerns or
fidelity results are rejected on import, and none of these appear in exports.

Bundles and exports use schema version `1.2.0`; older `1.1.0` bundles without
reference scoring are not accepted. A synthetic example bundle is available at
[`public/pairwise-evaluation-example.json`](./public/pairwise-evaluation-example.json).
