import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

const require = createRequire(import.meta.url)
let modulePath = process.env.REVIEW_SESSION_MODULE
if (!modulePath) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url))
  const temporaryDirectory = mkdtempSync(join(projectRoot, 'node_modules/.prebi-session-tests-'))
  after(() => rmSync(temporaryDirectory, { recursive: true, force: true }))
  const compilation = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', 'src/reviewSession.ts', '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node', '--ignoreDeprecations', '6.0', '--esModuleInterop', '--strict', '--skipLibCheck', '--outDir', temporaryDirectory], { cwd: projectRoot, stdio: 'inherit' })
  assert.equal(compilation.status, 0, 'Session helpers must compile')
  modulePath = join(temporaryDirectory, 'reviewSession.js')
}
const { parseReviewSession, visitReviewPacket, sessionKey, feedbackCount, reviewCaseState } = require(modulePath)
const bundle = JSON.parse(readFileSync(new URL('../public/examples/synthetic-review-bundle.json', import.meta.url), 'utf8'))

test('legacy bundles become self-contained resumable sessions without modifying the source', () => {
  const session = visitReviewPacket(parseReviewSession(bundle, 'session-test'), 1)
  assert.equal(sessionKey(session), `review::session-test::${bundle.bundle_id}`)
  assert.deepEqual(session.seen_packet_ids, [bundle.packets[1].review_packet_id])
  assert.deepEqual(parseReviewSession(JSON.parse(JSON.stringify(session))), session)
  assert.equal(bundle.progress, undefined)
})

test('annotations round-trip by packet and item with optional notes and evidence', () => {
  const session = parseReviewSession(bundle, 'session-test')
  const packet = bundle.packets[0]
  const item = packet.generated_feedback.strengths[0]
  session.annotations[packet.review_packet_id] = { [item.item_id]: { status: 'problem', comment: 'Prüfen', alternative: '', evidence_segment_ids: [packet.reflection.segments[0].segment_id] } }
  assert.deepEqual(parseReviewSession(session), session)
  assert.equal(feedbackCount(session), 1)
})

test('partial edited drafts and annotations on added items remain resumable', () => {
  const session = parseReviewSession(bundle, 'session-test')
  const packet = session.bundle.packets[0]
  const feedback = structuredClone(packet.generated_feedback)
  feedback.suggestions.push({ item_id: 'added-item', text: '', evidence_segment_ids: [] })
  const timestamp = '2026-10-07T12:00:00Z'
  session.bundle.progress.drafts[packet.review_packet_id] = { feedback, decision: 'use_with_edits', first_edited_at: timestamp, updated_at: timestamp }
  session.annotations[packet.review_packet_id] = { 'added-item': { status: 'problem', comment: '', alternative: 'Alternative' } }
  assert.deepEqual(parseReviewSession(JSON.parse(JSON.stringify(session))), session)
  assert.deepEqual(session.bundle.progress.approvals, {})
})

test('legacy progress restores seen cases and starts at the first unfinished case', () => {
  const legacy = structuredClone(bundle)
  const packet = legacy.packets[0]
  legacy.progress = { reviewer_id: 'session-test', drafts: {}, approvals: { [packet.review_packet_id]: { feedback: packet.generated_feedback, decision: 'use_as_generated', first_edited_at: null, approved_at: '2026-10-07T12:00:00Z', editing_to_approval_ms: null } } }
  const session = parseReviewSession(legacy)
  assert.equal(session.activeIndex, 1)
  assert.deepEqual(session.seen_packet_ids, [packet.review_packet_id])
})

test('reject malformed annotations, unknown references and invalid navigation', () => {
  const packet = bundle.packets[0]
  const item = packet.generated_feedback.strengths[0]
  for (const annotation of [{ status: 'other' }, { status: 'problem', comment: null }, { status: 'appropriate', alternative: 1 }, { status: 'problem', evidence_segment_ids: ['unknown'] }, { status: 'problem', evidence_segment_ids: [packet.reflection.segments[0].segment_id, packet.reflection.segments[0].segment_id] }, { status: 'problem', extra: true }]) {
    const session = parseReviewSession(bundle, 'session-test')
    session.annotations[packet.review_packet_id] = { [item.item_id]: annotation }
    assert.throws(() => parseReviewSession(session))
  }
  for (const patch of [{ activeIndex: -1 }, { activeIndex: 0.5 }, { activeIndex: bundle.packets.length }, { seen_packet_ids: ['unknown'] }, { seen_packet_ids: [packet.review_packet_id, packet.review_packet_id] }, { annotations: { unknown: {} } }, { annotations: { [packet.review_packet_id]: { unknown: { status: 'problem' } } } }]) {
    assert.throws(() => parseReviewSession({ ...parseReviewSession(bundle, 'session-test'), ...patch }))
  }
})

test('reserved case and item identifiers cannot resolve inherited object properties', () => {
  for (const identifier of ['constructor', '__proto__', 'prototype']) {
    const invalidPacket = structuredClone(bundle)
    invalidPacket.packets[0].review_packet_id = identifier
    assert.throws(() => parseReviewSession(invalidPacket, 'session-test'))
    const invalidItem = structuredClone(bundle)
    invalidItem.packets[0].generated_feedback.strengths[0].item_id = identifier
    assert.throws(() => parseReviewSession(invalidItem, 'session-test'))
  }
})

test('lecturer case state distinguishes seen-only cases from meaningful feedback', () => {
  const session = parseReviewSession(bundle, 'session-test')
  const packet = session.bundle.packets[0]
  assert.equal(reviewCaseState(session, packet), 'not_started')
  session.seen_packet_ids.push(packet.review_packet_id)
  assert.equal(reviewCaseState(session, packet), 'in_progress')
  session.bundle.progress.drafts[packet.review_packet_id] = { feedback: structuredClone(packet.generated_feedback), decision: null, first_edited_at: null, updated_at: '2026-10-07T10:00:00Z' }
  assert.equal(reviewCaseState(session, packet), 'in_progress')
  session.annotations[packet.review_packet_id] = { [packet.generated_feedback.strengths[0].item_id]: { status: 'problem', comment: 'Hinweis' } }
  assert.equal(reviewCaseState(session, packet), 'complete')
})