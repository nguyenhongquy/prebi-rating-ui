# PReBi Evaluator Guide

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
