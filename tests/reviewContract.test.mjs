import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { parseReviewBundle, initialReviewDraft, editReviewDraft, approveReview, approvalError, reviewIsCurrent } = await import(process.env.PREBI_REVIEW_MODULE)
const example = JSON.parse(readFileSync(new URL('../public/examples/synthetic-review-bundle.json', import.meta.url), 'utf8'))
const packet = example.packets[0]
const first = '2026-10-06T10:00:00.000Z'
const later = '2026-10-06T10:05:00.000Z'
const approved = '2026-10-06T10:10:00.000Z'

function editedDraft() {
  const draft = initialReviewDraft(packet, first)
  const feedback = structuredClone(draft.feedback)
  feedback.strengths[0].text = 'Lecturer edited feedback'
  return editReviewDraft(draft, feedback, first)
}

test('synthetic bundle passes separate schema and contains no rating protocol', () => {
  assert.equal(parseReviewBundle(example).packets.length, 2)
  assert.throws(() => parseReviewBundle({ packets: example.packets }), /Invalid lecturer review bundle/)
  assert.throws(() => parseReviewBundle({ ...example, schema_version: '2.0.0' }), /Invalid lecturer review bundle/)
})

test('duplicate packet IDs and dangling evidence rejected', () => {
  assert.throws(() => parseReviewBundle({ ...example, packets: [packet, packet] }), /unique/)
  const bad = structuredClone(example)
  bad.packets[0].generated_feedback.strengths[0].evidence_segment_ids = ['unknown']
  assert.throws(() => parseReviewBundle(bad), /unknown reflection segment/)
})

test('first edit recorded once and preserved through additional evidence edits', () => {
  const draft = editedDraft()
  const feedback = structuredClone(draft.feedback)
  feedback.strengths[0].evidence_segment_ids.push('synthetic-01-34')
  const updated = editReviewDraft(draft, feedback, later)
  assert.equal(updated.first_edited_at, first)
  assert.equal(updated.updated_at, later)
  assert.equal(updated.decision, 'use_with_edits')
  assert.equal(packet.generated_feedback.strengths[0].text, example.packets[0].generated_feedback.strengths[0].text)
  assert.deepEqual(packet.generated_feedback.strengths[0].evidence_segment_ids, ['synthetic-01-33'])
})

test('evidence-only edit starts editing clock; no-op does not', () => {
  const draft = initialReviewDraft(packet, first)
  assert.equal(editReviewDraft(draft, structuredClone(draft.feedback), later), draft)
  const feedback = structuredClone(draft.feedback)
  feedback.strengths[0].evidence_segment_ids = ['synthetic-01-34']
  assert.equal(editReviewDraft(draft, feedback, later).first_edited_at, later)
})

test('unchanged approval leaves editing interval null', () => {
  const draft = { ...initialReviewDraft(packet, first), decision: 'use_as_generated' }
  const approval = approveReview(packet, draft, approved)
  assert.equal(approval.first_edited_at, null)
  assert.equal(approval.editing_to_approval_ms, null)
})

test('edited approval records wall-clock interval and immutable snapshot', () => {
  const draft = editedDraft()
  const approval = approveReview(packet, draft, approved)
  assert.equal(approval.editing_to_approval_ms, 600000)
  draft.feedback.strengths[0].text = 'Further pending change'
  assert.equal(approval.feedback.strengths[0].text, 'Lecturer edited feedback')
  assert.equal(reviewIsCurrent(draft, approval), false)
})

test('decision requirements and earlier clock prevent approval', () => {
  assert.match(approvalError(packet, initialReviewDraft(packet, first)), /Choose/)
  assert.match(approvalError(packet, { ...editedDraft(), decision: 'use_as_generated' }), /restore/)
  assert.match(approvalError(packet, { ...initialReviewDraft(packet, first), decision: 'use_with_edits' }), /Edit/)
  assert.throws(() => approveReview(packet, editedDraft(), '2026-10-06T09:00:00.000Z'), /earlier/)
})

test('partial bundle export round trip preserves original, timestamps and evidence', () => {
  const draft = editedDraft()
  const approval = approveReview(packet, draft, approved)
  const bundle = { ...example, progress: { reviewer_id: 'synthetic-reviewer', drafts: { [packet.review_packet_id]: draft }, approvals: { [packet.review_packet_id]: approval } } }
  const resumed = parseReviewBundle(JSON.parse(JSON.stringify(bundle)))
  assert.deepEqual(resumed, bundle)
  assert.equal(reviewIsCurrent(resumed.progress.drafts[packet.review_packet_id], resumed.progress.approvals[packet.review_packet_id]), true)
  assert.equal(resumed.packets[1].review_packet_id, 'synthetic-review-02')
})

test('unknown progress and inconsistent imported timestamps rejected', () => {
  const draft = editedDraft()
  const approval = approveReview(packet, draft, approved)
  const bundle = { ...example, progress: { reviewer_id: 'reviewer', drafts: { [packet.review_packet_id]: draft }, approvals: { [packet.review_packet_id]: approval } } }
  const invalidTiming = structuredClone(bundle)
  invalidTiming.progress.approvals[packet.review_packet_id].editing_to_approval_ms = 1
  assert.throws(() => parseReviewBundle(invalidTiming), /timing/)
  const missingFirst = structuredClone(bundle)
  missingFirst.progress.drafts[packet.review_packet_id].first_edited_at = null
  assert.throws(() => parseReviewBundle(missingFirst), /first-edit/)
  assert.throws(() => parseReviewBundle({ ...example, progress: { reviewer_id: 'reviewer', drafts: { unknown: draft }, approvals: {} } }), /unknown review packet/)
})

test('unfinished blank draft items can be exported and resumed but not approved', () => {
  const draft = editedDraft()
  draft.feedback.suggestions.push({ item_id: 'unfinished', text: '', evidence_segment_ids: [] })
  const bundle = { ...example, progress: { reviewer_id: 'reviewer', drafts: { [packet.review_packet_id]: draft }, approvals: {} } }
  assert.equal(parseReviewBundle(bundle).progress.drafts[packet.review_packet_id].feedback.suggestions.at(-1).text, '')
  assert.match(approvalError(packet, draft), /blank/)
})

test('generated blank items and duplicate segment numbers are rejected', () => {
  const blank = structuredClone(example)
  blank.packets[0].generated_feedback.strengths[0].text = ' '
  assert.throws(() => parseReviewBundle(blank), /cannot be blank/)
  const duplicate = structuredClone(example)
  duplicate.packets[0].reflection.segments[1].order = duplicate.packets[0].reflection.segments[0].order
  assert.throws(() => parseReviewBundle(duplicate), /unique/)
})

test('approval-only progress can resume without a draft snapshot', () => {
  const approval = approveReview(packet, { ...initialReviewDraft(packet, first), decision: 'use_as_generated' }, approved)
  const resumed = parseReviewBundle({ ...example, progress: { reviewer_id: 'reviewer', drafts: {}, approvals: { [packet.review_packet_id]: approval } } })
  assert.equal(reviewIsCurrent(undefined, resumed.progress.approvals[packet.review_packet_id]), true)
})