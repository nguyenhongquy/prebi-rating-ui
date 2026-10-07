# Lecturer Review Contract 1.0.0

This browser-only workflow is separate from expert evaluation. Open
`http://127.0.0.1:5174/?workflow=review` or use the Lecturer review link.
The authoritative JSON Schema and semantic checks are in `src/reviewContract.ts`.
Download the schema from Review files on the start screen. The two packets in
`public/examples/synthetic-review-bundle.json` are entirely synthetic. Never put
real review bundles or exported progress in the application's public directory.

## Bundle

- `kind`: `prebi_lecturer_review_bundle`.
- `schema_version`: `1.0.0`.
- `bundle_id`: stable unique ID for this source bundle.
- `packets`: nonempty ordered array; lecturer review does not randomize it.
- `progress`: optional for new bundles, included in all progress exports.

Packets contain `review_packet_id`, a pseudonymous `source_reference`,
`reflection.segments`, and `generated_feedback`. Segments preserve `segment_id`,
zero-based `order`, and `text`; the UI displays `order + 1`. Segment IDs and orders
are unique per packet. Packet IDs are unique per bundle.

Feedback contains `strengths`, `weaknesses`, and `suggestions` arrays. Items have
`item_id`, `text`, and `evidence_segment_ids`. Item IDs are unique across the
packet's sections, and evidence IDs must exist in that packet's reflection.
Lecturers can edit, add/remove items, and add/remove evidence links. New items
receive fresh IDs. Original feedback and evidence stay unchanged in `packets`.

## Progress

`progress` contains `reviewer_id`, `drafts`, and `approvals`. Both maps are keyed
by `review_packet_id`, with no unknown packet keys. Reviewer codes are pseudonymous
and locked while a bundle is open.

Draft fields: `feedback`, `decision`, `first_edited_at`, and `updated_at`.
Decisions are null, `use_as_generated`, `use_with_edits`, or `do_not_use`.
Blank unfinished items are exportable and resumable but cannot be approved.
Use as generated requires feedback/evidence to match the source. Use with edits
requires an actual difference. Either use decision requires some feedback.
Do not use records a rejection, not delivery.

Approval fields: `feedback`, `decision`, `first_edited_at`, `approved_at`, and
`editing_to_approval_ms`. Approvals are independent snapshots. Subsequent draft
edits mark the packet pending without altering its last approval. Consumers must
not treat a stale approval as the current draft. An approval is current when its
feedback, decision, and first-edit timestamp match the draft. This version retains
the latest approval, not a full approval history.

## Timing

ISO 8601 UTC `first_edited_at` is recorded on the first actual text, item, or
evidence change, not on opening a packet or selecting a decision. It is retained
through further edits, restoration, approval updates, export, and resume.
`updated_at` tracks the most recent edit/decision change. Unedited approvals have
null first-edit time and null elapsed interval.

```text
editing_to_approval_ms = Date.parse(approved_at) - Date.parse(first_edited_at)
```

This is wall-clock elapsed time, including pauses, closed-browser time, and
resume delays. It is not active editing time. Imports validate timestamps and
interval consistency. Approval before first edit is rejected; device-clock
accuracy still matters.

## Export And Resume

Export progress creates `prebi-review-progress.json`, containing original packets,
reviewer code, unfinished drafts, approvals, and timestamps. The same contract is
used at completion. Upload this file to resume on another browser/device. No
backend is involved. Approve & next records a decision locally; no feedback is
sent to students. Delivery and production packet generation are out of scope.

Storage keys are `prebi-lecturer-review-v1` (reviewer/bundle keyed bundles) and
`prebi-lecturer-reviewer-v1` (code). Expert ratings are not read or modified.
Reopening an original bundle restores local progress for the same reviewer and
bundle. Uploading different progress over existing local progress requires
replacement confirmation; no automatic merge is performed. A bundle ID with
different source material is rejected, as is a mismatched reviewer. Close the
bundle to change reviewer code.

Review files on onboarding can export stored bundles for the entered reviewer.
Storage failure produces a warning: export before leaving the page. Transfer
review bundles and exports through an approved protected channel.