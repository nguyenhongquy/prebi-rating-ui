# PREBI Rating UI

Standalone browser-only annotation app. No research-workbench
or Python backend is required, and the annotation workflow makes no API or model
requests. Uploaded packet data stays in the browser; drafts and submitted ratings
are stored in localStorage until cleared. Treat the browser profile as protected
storage, and download results before clearing it.

## Run

From the standalone repository root (Node.js 22.12 or newer):

```bash
npm ci
npm run dev
```

When working inside the private parent repository, use
`npm --prefix rating-ui ci` and `npm --prefix rating-ui run dev` instead.

Open the localhost URL printed by Vite (normally http://127.0.0.1:5174).
Enter an assigned pseudonymous annotator code on the start screen, then select
**Open evaluation packet**. Upload the blinded packet bundle, never the protected
condition key. The three task tabs separate assessment
quality, feedback quality, and feedback-implied score coding.

Once a bundle is open, **Files & local data** contains packet replacement,
task-specific export, and clear-data actions. After a reload, reopen the packet
bundle to continue existing drafts. **Stored responses** on the start screen can
export all previously submitted ratings for the entered annotator without
reopening a bundle. It uses the existing rating records and export envelope;
drafts are not included. Packet order is still randomized on each import.

## Branding And Shared Shell

The shared `AppShell` presents the PH Ludwigsburg identity and a workflow label.
The expert onboarding screen is separate from the annotation workspace. Lecturer
review has its own workspace and versioned contract; research rating controls
and contracts remain unchanged.

`SourceComparison` combines shared `ReflectionViewer` and `OutputViewer`
components. On desktop, reflection and output scroll independently, and the
comparison region stays visible while the page scrolls through ratings. Narrow
screens use a non-sticky layout, with stacked viewers on phones. Feedback sections
are vertical rather than three narrow columns; text areas expand to display their
full text while preserving the original selection offsets for span annotations.

Evidence references display the existing one-based reflection segment numbers,
not underlying IDs. Hover or keyboard focus previews a PH leaf-green highlight;
activation retains the highlight and scrolls only the reflection viewer. Missing
references show an unavailable state instead of being assigned a guessed number.
Packet navigation resets highlights and pending excerpt selections. Packet IDs,
evidence IDs, stored drafts, rating scales, anchors, and exports are unchanged.
The rubric and rating guide are available in the packet navigation column.

### Rating Navigation And Completion

Quality tasks show one criterion at a time; feedback-implied score tasks show one
dimension at a time. Criterion labels, descriptions, anchors, scales, and required
answers are taken unchanged from the packet. The step navigator allows revisiting
any answer. **Save & next** validates the active answer and advances; drafts are
still autosaved through the existing browser storage. The final **Submit rating**
or **Update rating** validates every required answer, returns to the first
incomplete one if necessary, and saves the original response format.

After submission, navigation advances to the next packet without a current
submission in the existing randomized task order. Packet buttons distinguish
not-started packets, drafts, submissions, and pending changes. Draft completion
does not count as submission. Editing a submitted response marks it pending and
removes it from current completion until updated; existing exports still contain
the last submitted response, not the pending edits.

Finishing a task shows **Task complete** and task export, with a route to the next
unfinished task. **Evaluation complete** appears only when all loaded packets
across all tasks have current submissions. Its **Export ratings** action exports
all loaded submitted records for the current annotator to `ratings-evaluation.json`
using the existing `schema_version` and `ratings` envelope. Other annotators and
unloaded packets are excluded. **Review ratings** reopens the workspace; the
completion screen can be reopened without changing responses. Reopening a fully
submitted bundle restores its completion screen.

The approved logo and local Figtree Regular, Medium, SemiBold, and Bold files are
served from `rating-ui/public/`. The font license is included under
`public/fonts/Figtree/OFL.txt`. No external font service is used. Only branding
assets and explicitly synthetic examples belong here because Vite copies it into the static
build. The repository-root `public/` directory is not served by this application.

## Lecturer Review

Open `http://127.0.0.1:5174/?workflow=review` or use the Lecturer review link. Enter
a reviewer code and open the synthetic example to try feedback editing, adding
items, marking new reflection evidence, review decisions, and approval. Select
an item's Mark evidence action, then toggle its reflection segments. Original
generated feedback is preserved separately.

Export progress includes original packets, unfinished drafts, approvals, and
timestamps. Upload it to resume work, including on another browser. First-edit
timing includes evidence changes and survives resume; elapsed time to approval
includes pauses and is not active editing time. Review uses separate storage and
no research rating controls. Approval does not deliver feedback to students.
See [REVIEW_CONTRACT.md](REVIEW_CONTRACT.md) for the contract and conflict behavior.
Download the schema from Review files on the start screen.

## Rating Protocols

Feedback protocol `0.2.0` and assessment protocol `0.3.0` use three-point scales with criterion-specific anchors.
Feedback quality rates correctness and developmental usefulness; assessment
quality rates Score-Rubric Fit, Evidence Support, and Justification Quality.
Assessment `0.2.0` retains four criteria for legacy packets. Unable-to-judge is separate and requires a
reason. Legacy `0.1.0` packets retain their five-point scale. Feedback-implied
learner scores remain 0.0-3.0 in tenths, not quality ratings. Export a separate new
packet campaign to adopt a revised protocol; do not edit existing packets or mix
ratings across versions.

## Tests

```bash
npm test
```

The Node built-in test runner uses the installed TypeScript compiler in a temporary
directory. Tests use synthetic data without browser storage or research packets.
Ajv and ajv-formats validate review imports. Tests cover answer validation,
legacy scales, response envelopes, excerpt preservation, pending edits, review
timing, evidence validation, and partial-bundle resume. Browser checks additionally
exercise criterion navigation, mixed-task completion, exports, keyboard access,
annotator isolation, and desktop/mobile layouts with synthetic packets.

## Build

```bash
npm run build
```

The static build is in `dist` (`rating-ui/dist` in the private parent repository).
It contains code, branding, and synthetic examples. Never put research
packets, condition keys, or rating exports in this app directory or a public
static host. Distribute packets and collect downloaded ratings through an
approved protected channel. Browser drafts are origin-specific; changing host,
port, or browser profile does not transfer drafts. Existing drafts from the
research workbench origin are not automatically migrated.

## GitHub Pages

Publish only this application directory as a standalone repository, with a fresh
Git history. Do not copy the private parent repository's `.git` directory or
publish its history. Before publishing, check every tracked file for research
data, credentials, and material not approved for public redistribution. The
bundled font license is included; institutional and project branding must also
be approved for public use. No software license is implied by publication.

In the standalone GitHub repository, open **Settings > Pages** and set the build
source to **GitHub Actions**. The included `.github/workflows/pages.yml` tests and
builds the app on pushes to `main`, then deploys only `dist`. It can also be run
manually from the Actions tab. Repository administration permission is needed
to enable Pages.

The Vite base is relative (`./`), so assets and synthetic examples work at
`https://<owner>.github.io/<repository>/` without a hard-coded repository name.
Lecturer review is available at the same URL with `?workflow=review`.
`private: true` in the npm manifest prevents accidental npm publication; it does
not prevent a public GitHub repository or GitHub Pages deployment.

Only application code, documentation, branding, fonts, and synthetic fixtures
belong in this repository. Ignored packet/export folders are a precaution, not a
data-loss-prevention boundary: always review files before committing. A public
Pages URL does not authenticate raters or protect distributed packet files.