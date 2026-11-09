import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const domain = require(process.env.PREBI_LECTURER_SESSION_MODULE)
const { SYNTHETIC_CASE, createFakeLecturerService } = require(process.env.PREBI_LECTURER_SERVICE_MODULE)
const now = '2026-11-09T12:00:00.000Z'
let counter = 0
const id = () => `id-${++counter}`
const fresh = () => domain.createLecturerSession(SYNTHETIC_CASE, id())
function rated() {
  let session = fresh()
  for (const dimension of domain.DIMENSIONS) session = domain.setScore(session, dimension, 1.5)
  return domain.confirmScores(session, now)
}
async function generated() {
  let session = rated()
  const service = createFakeLecturerService({ delayMs: 0 })
  for (const condition of domain.CONDITIONS) {
    const attempt = id()
    session = domain.beginAttempt(session, condition, attempt)
    session = domain.finishAttempt(session, session.id, condition, attempt, { result: await service.generate(session.prepared, condition, attempt) })
  }
  return session
}
async function drafted(preference = 'tie') {
  return domain.startDraft(domain.choosePreference(await generated(), preference), 'G1', id)
}

test('new synthetic session is isolated, versioned and round-trips', () => {
  const session = fresh()
  assert.deepEqual(domain.parseLecturerSession(JSON.parse(JSON.stringify(session))), session)
  session.prepared.segments[0].text = 'Changed locally'
  assert.notEqual(SYNTHETIC_CASE.segments[0].text, session.prepared.segments[0].text)
  assert.throws(() => domain.parseLecturerSession({ ...session, schema_version: '2.0.0' }))
  assert.throws(() => domain.parseLecturerSession({ ...session, kind: 'prebi_lecturer_session' }))
  assert.throws(() => domain.parseLecturerSession({ ...session, unknown: true }))
})

test('all rating values are measured exactly; confirmation and generation cannot bypass gates', () => {
  const session = fresh()
  for (const value of [-1, 0.1, 3.5, '1', NaN]) assert.throws(() => domain.setScore(session, 'SW', value))
  for (const value of [0, 0.5, 1, 1.5, 2, 2.5, 3]) assert.equal(domain.setScore(session, 'SW', value).scores.SW, value)
  assert.throws(() => domain.confirmScores(session, now))
  assert.throws(() => domain.beginAttempt(session, 'G1', id()))
  assert.throws(() => domain.choosePreference(session, 'G1'))
  assert.throws(() => domain.startDraft(session, 'blank', id))
  assert.throws(() => domain.approveDraft(session, true, now))
  assert.throws(() => domain.setScore(rated(), 'SW', 2))
  assert.throws(() => domain.confirmScores(domain.setScore(domain.setScore(domain.setScore(session, 'SW', 1), 'UA', 1), 'HA', 1), '2026-99-99T12:00:00.000Z'))
})

test('partial failure preserves success; retries are explicit and sequential', async () => {
  let session = rated()
  const fake = createFakeLecturerService({ delayMs: 0, failOnce: ['G2'] })
  for (const condition of domain.CONDITIONS) {
    const attempt = id()
    session = domain.beginAttempt(session, condition, attempt)
    assert.throws(() => domain.beginAttempt(session, condition === 'G1' ? 'G2' : 'G1', id()))
    try { session = domain.finishAttempt(session, session.id, condition, attempt, { result: await fake.generate(session.prepared, condition, attempt) }) }
    catch (error) { session = domain.finishAttempt(session, session.id, condition, attempt, { error: error.message }) }
  }
  const original = structuredClone(session.candidates.G1.result)
  assert.equal(session.candidates.G2.status, 'failed')
  assert.throws(() => domain.choosePreference(session, 'tie'))
  assert.throws(() => domain.beginAttempt(session, 'G1', id()))
  const attempt = id()
  session = domain.beginAttempt(session, 'G2', attempt)
  session = domain.finishAttempt(session, session.id, 'G2', attempt, { result: await fake.generate(session.prepared, 'G2', attempt) })
  assert.deepEqual(session.candidates.G1.result, original)
  assert.equal(domain.bothSucceeded(session), true)
})

test('late, duplicate and obsolete results are ignored without changing state', async () => {
  const pending = domain.beginAttempt(rated(), 'G1', id())
  const attempt = pending.candidates.G1.attemptId
  for (const [sessionId, attemptId] of [['other-case', attempt], [pending.id, 'old-attempt']]) {
    assert.equal(domain.finishAttempt(pending, sessionId, 'G1', attemptId, { result: {} }), pending)
  }
  const reopened = domain.reopenScores(pending)
  assert.equal(domain.finishAttempt(reopened, pending.id, 'G1', attempt, { result: {} }), reopened)
  const completed = await generated()
  assert.equal(domain.finishAttempt(completed, completed.id, 'G1', completed.candidates.G1.attemptId, { result: {} }), completed)
})

test('pending restores as interrupted, never silently retries or succeeds', () => {
  const pending = domain.beginAttempt(rated(), 'G1', id())
  const restored = domain.parseLecturerSession(JSON.parse(JSON.stringify(pending)))
  assert.equal(restored.candidates.G1.status, 'interrupted')
  assert.match(restored.candidates.G1.error, /unbekannt/)
  assert.equal(pending.candidates.G1.status, 'pending')
  assert.equal(domain.beginAttempt(restored, 'G1', id()).candidates.G1.status, 'pending')
  const invalid = structuredClone(pending)
  invalid.candidates.G2 = { ...invalid.candidates.G1, attemptId: id() }
  assert.throws(() => domain.parseLecturerSession(invalid, false))
  assert.throws(() => domain.parseLecturerSession(invalid))
})

test('all preferences are explicit; draft source is independent of preference', async () => {
  const generatedSession = await generated()
  for (const preference of ['G1', 'G2', 'tie', 'neither']) {
    const session = domain.choosePreference(generatedSession, preference)
    assert.equal(session.comparison.preference, preference)
    for (const source of ['G1', 'G2', 'blank']) {
      const draftedSession = domain.startDraft(session, source, id)
      assert.equal(draftedSession.draft.items.length, source === 'blank' ? 0 : 3)
      if (source !== 'blank') assert.equal(draftedSession.draft.items[0].source.candidateId, session.candidates[source].result.id)
    }
  }
  assert.throws(() => domain.choosePreference(generatedSession, 'unspecified'))
})

test('editing, adding, deleting and copying retain originals, stable IDs and provenance', async () => {
  const session = await drafted()
  const original = structuredClone(session.candidates)
  const items = structuredClone(session.draft.items)
  items[0].text = 'Edited'
  items.push({ id: id(), category: 'suggestions', text: 'Manual', evidence: [], source: null })
  const changed = domain.editDraft(session, items)
  assert.equal(changed.draft.items[0].id, session.draft.items[0].id)
  assert.equal(session.draft.items[0].text, original.G1.result.items[0].text)
  assert.deepEqual(changed.candidates, original)
  const deleted = domain.editDraft(changed, changed.draft.items.slice(1))
  assert.equal(deleted.draft.items.length, items.length - 1)
  for (const patch of [{ evidence: ['unknown'] }, { evidence: ['s1', 's1'] }, { source: { candidateId: 'missing', itemId: 'missing' } }]) {
    assert.throws(() => domain.editDraft(session, [{ ...items[0], ...patch }]))
  }
  assert.throws(() => domain.editDraft(session, [items[0], items[0]]))
})

test('approval needs explicit review and nonblank content; missing links warn but allow approval', async () => {
  let session = await drafted()
  assert.throws(() => domain.approveDraft(session, false, now))
  assert.throws(() => domain.approveDraft(domain.editDraft(session, []), true, now))
  assert.throws(() => domain.approveDraft(domain.editDraft(session, [{ ...session.draft.items[0], text: '  ' }]), true, now))
  session = domain.editDraft(session, [{ ...session.draft.items[0], evidence: [] }])
  const approved = domain.approveDraft(session, true, now)
  assert.equal(domain.approvalCurrent(approved), true)
  assert.throws(() => domain.approveDraft(approved, true, now))
  assert.deepEqual(domain.parseLecturerSession(JSON.parse(JSON.stringify(approved))), approved)
  const changed = domain.editDraft(approved, [{ ...approved.draft.items[0], text: 'New text' }])
  assert.equal(domain.approvalCurrent(changed), false)
  assert.notEqual(changed.approvals[0].draft.items[0].text, changed.draft.items[0].text)
})

test('preference changes preserve draft, stale approval, require reconfirmation even if changed back', async () => {
  let session = domain.approveDraft(await drafted('G1'), true, now)
  const original = structuredClone(session.draft)
  session = domain.choosePreference(session, 'G2')
  assert.deepEqual(session.draft, original)
  assert.equal(domain.approvalCurrent(session), false)
  assert.throws(() => domain.editDraft(session, original.items))
  assert.throws(() => domain.approveDraft(session, true, now))
  session = domain.choosePreference(session, 'G1')
  assert.equal(domain.approvalCurrent(session), false)
  session = domain.reconfirmDraft(session)
  assert.equal(domain.approvalCurrent(session), false)
  session = domain.approveDraft(session, true, now)
  assert.equal(session.approvals.length, 2)
  assert.equal(domain.approvalCurrent(session), true)
})

test('reopening ratings clears every downstream dependency and retains score values for correction', async () => {
  const approved = domain.approveDraft(await drafted(), true, now)
  const reopened = domain.reopenScores(approved)
  assert.deepEqual(reopened.scores, approved.scores)
  assert.equal(reopened.confirmedAt, null)
  assert.equal(reopened.candidates.G1.status, 'idle')
  assert.equal(reopened.candidates.G2.result, null)
  assert.equal(reopened.comparison, null)
  assert.equal(reopened.draft, null)
  assert.deepEqual(reopened.approvals, [])
  assert.equal(domain.setScore(reopened, 'SW', 3).scores.SW, 3)
})

test('restore rejects malformed states, foreign references and forged current approval bindings', async () => {
  const session = domain.approveDraft(await drafted(), true, now)
  const corruptions = [
    value => { value.scores.SW = null },
    value => { value.candidates.G1.status = 'failed' },
    value => { value.candidates.G1.result.documentId = 'other' },
    value => { value.candidates.G1.result.rubricVersion = 'other' },
    value => { value.candidates.G1.result.items[0].text = '' },
    value => { value.prepared.segments[1].segment_id = 's1' },
    value => { value.prepared.segments[0].order = 2 },
    value => { value.comparison.candidateIds.reverse() },
    value => { value.draft.items[0].evidence = ['foreign'] },
    value => { value.approvals[0].draft.items[0].text = 'Forged current approval' },
    value => { value.approvals[0].preference = 'neither' },
    value => { value.approvals[0].draft.revision += 1 },
  ]
  for (const corrupt of corruptions) {
    const invalid = structuredClone(session)
    corrupt(invalid)
    assert.throws(() => domain.parseLecturerSession(invalid))
  }
})

test('fake service accepts prepared input only, never ratings; preparation is cloned', async () => {
  const fake = createFakeLecturerService({ delayMs: 0 })
  assert.equal(fake.generate.length, 3)
  const prepared = await fake.prepare()
  prepared.segments[0].text = 'Changed'
  assert.notEqual((await fake.prepare()).segments[0].text, 'Changed')
})

test('all accepted sessions serialize within the actual UTF-8 backup import limit', async () => {
  const session = await drafted()
  const items = Array.from({ length: 130 }, (_, index) => ({ id: `manual-${index}`, category: 'suggestions', text: 'ü'.repeat(20000), evidence: [], source: null }))
  assert.throws(() => domain.editDraft(session, items), /5 MB/)
  const smaller = domain.editDraft(session, items.slice(0, 100))
  const backup = JSON.stringify(smaller, null, 2)
  assert.ok(Buffer.byteLength(backup, 'utf8') <= domain.MAX_BACKUP_BYTES)
  assert.deepEqual(domain.parseLecturerSession(JSON.parse(backup)), smaller)
})
