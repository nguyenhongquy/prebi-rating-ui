import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const api = require(join(dirname(process.env.PREBI_LECTURER_SESSION_MODULE), 'lecturerApi.js'))
const domain = require(process.env.PREBI_LECTURER_SESSION_MODULE)
const { SYNTHETIC_CASE } = require(process.env.PREBI_LECTURER_SERVICE_MODULE)
const dims = ['SW', 'UA', 'HA']
const anchors = { 0: 'None', 1: 'Basic', 2: 'Clear', 3: 'Detailed' }
const materials = {
  generation_rubric: {
    artifact_id: 'test-rubric', version: '1.2.0', sha256: 'a'.repeat(64),
    content: { rubric_id: 'test-rubric', version: '1.2.0', glossary: { term: 'Definition' }, dimensions: dims.map(dimension_id => ({ dimension_id, name: dimension_id, description: 'Description', bands: anchors })) },
  },
  scoring_guide: {
    artifact_id: 'test-guide', version: '0.1.0', sha256: 'b'.repeat(64),
    content: {
      guide_id: 'test-guide', version: '0.1.0', status: 'approved',
      scale: { allowed_scores: [0, 0.5, 1, 1.5, 2, 2.5, 3] },
      dimensions: dims.map(dimension_id => ({ dimension_id, name: dimension_id, focus: 'Focus', anchors })),
      scoring_principles: ['Rate independently.'],
      intermediate_score_guidance: { '0.5': 'Half', '1.5': 'One half', '2.5': 'Two half', required_justification: 'Explain.' },
      generation_rubric: { rubric_id: 'test-rubric', version: '1.2.0', relationship: 'Related' },
    },
  },
  relationship: 'Related',
}
const preparation = {
  document: { document_id: 'doc-1', segments: [{ segment_id: 's1', text: 'Synthetic reflection.', order: 2 }, { segment_id: 's2', text: 'Synthetic header.', order: 5 }] },
  analysis: { source: 'predicted', segments: [
    { segment_id: 's1', scope: 'in_scope', component_bands: { SW: '1', UA: '0', HA: '2' } },
    { segment_id: 's2', scope: 'out_of_scope', component_bands: { SW: 'N', UA: 'N', HA: 'N' } },
  ], summary: null },
  segment_locations: [{ segment_id: 's1', page_number: 1, start_char: 0, end_char: 21 }, { segment_id: 's2', page_number: 1, start_char: 22, end_char: 39 }],
}
function generation(condition) {
  const claim = { interpretation: 'Synthetic claim.', evidence_refs: ['s1'] }
  return {
    generation_id: `run-${condition}`, condition, document_id: 'doc-1', feedback_letter: 'Synthetic letter.',
    provenance: { model_name: 'fake', pipeline_version: '2.0.0', prompt_version: '2.0.0', rubric_id: 'test-rubric', rubric_version: '1.2.0', rubric_sha256: 'a'.repeat(64) },
    output: {
      feedback: { strengths: [{ message: 'A strength.', evidence_segment_ids: ['s1'] }], weaknesses: [], suggestions: [] },
      assessment: { component_assessments: dims.map(dimension_id => ({ dimension_id, band: 1, justification: 'Synthetic.', evidence_segment_ids: ['s1'], intermediate_score_explanation: null })) },
      evidence_synthesis: dims.map(dimension_id => ({ dimension_id, demonstrated_depth: [claim], development: [claim], integrative_coherence: [claim], limitations: [], uncertainty: [] })),
    },
  }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function backend() {
  const calls = []
  let fail = true
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('rating-materials')) return json(materials)
    if (url.endsWith('preparations')) return json(preparation)
    const body = JSON.parse(init.body)
    if (body.condition === 'G2' && fail) { fail = false; return json({ detail: 'PRIVATE_PROVIDER_SECRET' }, 502) }
    return json(generation(body.condition))
  }
  return { calls, service: api.createHttpLecturerService(fetcher) }
}
function rated(prepared) {
  let session = domain.createLecturerSession(prepared, 'api-session')
  for (const dimension of dims) session = domain.setScore(session, dimension, 1.5)
  return domain.confirmScores(session, '2026-11-10T12:00:00.000Z')
}

test('HTTP preparation uploads FormData, preserves N/scope/order and server materials', async () => {
  const { service, calls } = backend()
  const file = new File(['synthetic'], 'test.pdf', { type: 'application/pdf' })
  const prepared = await service.prepare(file)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/api/v1/rating-materials')
  assert.equal(calls[1].init.body.get('file').name, 'test.pdf')
  assert.equal(calls[1].init.headers, undefined)
  assert.equal(calls[1].init.cache, 'no-store')
  assert.equal(prepared.provenance, 'http-api-v1')
  assert.deepEqual(prepared.api.preparation, preparation)
  assert.deepEqual(prepared.api.materials, materials)
  assert.equal(prepared.segments[0].prediction.UA, 0)
  assert.equal(prepared.segments[1].prediction.SW, null)
  assert.match(prepared.rubric.guidance, /Rate independently/)
  assert.match(prepared.rubric.guidance, /Explain/)
  assert.deepEqual(domain.parsePrepared(prepared), prepared)
})

test('API session roundtrip retains full results; partial failure retries only G2 and approval still stales', async () => {
  const { service, calls } = backend()
  let session = rated(api.mapApiPrepared(preparation, materials))
  for (const condition of ['G1', 'G2']) {
    const attempt = `attempt-${condition}`
    session = domain.beginAttempt(session, condition, attempt)
    try {
      session = domain.finishAttempt(session, session.id, condition, attempt, { result: await service.generate(session.prepared, condition, attempt, true) })
    } catch (error) {
      assert.doesNotMatch(error.message, /PRIVATE/)
      session = domain.finishAttempt(session, session.id, condition, attempt, { error: error.message })
    }
  }
  assert.equal(domain.bothSucceeded(session), false)
  assert.throws(() => domain.choosePreference(session, 'tie'))
  const original = structuredClone(session.candidates.G1.result)
  session = domain.beginAttempt(session, 'G2', 'retry')
  session = domain.finishAttempt(session, session.id, 'G2', 'retry', { result: await service.generate(session.prepared, 'G2', 'retry', true) })
  assert.deepEqual(session.candidates.G1.result, original)
  assert.deepEqual(calls.map(call => JSON.parse(call.init.body).condition), ['G1', 'G2', 'G2'])
  const first = JSON.parse(calls[0].init.body)
  assert.equal('analysis' in first, false)
  assert.deepEqual(Object.keys(first).sort(), ['allow_external_generation', 'condition', 'document', 'expected_rubric'])
  const second = JSON.parse(calls[1].init.body)
  assert.deepEqual(second.analysis, { source: 'predicted', segments: preparation.analysis.segments })
  assert.deepEqual(second.expected_rubric, { rubric_id: 'test-rubric', version: '1.2.0', sha256: 'a'.repeat(64) })
  session = domain.startDraft(domain.choosePreference(session, 'tie'), 'G1', () => 'draft-1')
  session = domain.approveDraft(session, true, '2026-11-10T12:01:00.000Z')
  assert.equal(session.schema_version, '1.1.0')
  assert.equal(domain.approvalCurrent(session), true)
  assert.deepEqual(domain.parseLecturerSession(JSON.parse(JSON.stringify(session))), session)
  assert.deepEqual(session.candidates.G1.result.api, generation('G1'))
  session = domain.editDraft(session, session.draft.items.map(item => ({ ...item, text: 'Edited.' })))
  assert.equal(domain.approvalCurrent(session), false)
})

test('API generation requires explicit opt-in before any request; uploads reject exact byte-limit overflow', async () => {
  const { service, calls } = backend()
  await assert.rejects(service.generate(api.mapApiPrepared(preparation, materials), 'G1', 'attempt'), /Bestätigen/)
  await assert.rejects(service.prepare(), /PDF/)
  await assert.rejects(service.prepare(new File([], 'empty.pdf')), /PDF/)
  await assert.rejects(service.prepare(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf')), /PDF/)
  assert.equal(calls.length, 0)
  await service.prepare(new File([new Uint8Array(10 * 1024 * 1024)], 'boundary.pdf'))
  assert.equal(calls.length, 2)
})

test('malformed, unsupported, oversized and disconnected responses fail explicitly without body leakage or retry', async () => {
  for (const response of [
    () => new Response('PRIVATE', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('PRIVATE', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('x'.repeat(5_000_001), { headers: { 'Content-Type': 'application/json' } }),
    () => json({ private: 'PRIVATE' }),
    () => json({ detail: 'PRIVATE' }, 409),
    () => json({ detail: 'PRIVATE' }, 500),
    () => { throw new Error('PRIVATE') },
  ]) {
    let calls = 0
    const service = api.createHttpLecturerService(async () => { calls++; return response() })
    await assert.rejects(service.prepare(new File(['x'], 'test.pdf')), error => !error.message.includes('PRIVATE'))
    assert.equal(calls, 1)
  }
})

test('prepared state rejects broken coverage, scope, material binding, locations and altered backup projection', () => {
  for (const mutate of [
    value => { value.analysis.segments[0].segment_id = 'unknown' },
    value => { value.analysis.segments.push(value.analysis.segments[0]) },
    value => { value.analysis.segments[0].component_bands.SW = 'N' },
    value => { value.document.segments[1].order = 2 },
    value => { value.segment_locations[1].segment_id = 's1' },
  ]) {
    const value = structuredClone(preparation)
    mutate(value)
    assert.throws(() => api.mapApiPrepared(value, materials))
  }
  const changedMaterials = structuredClone(materials)
  changedMaterials.scoring_guide.content.generation_rubric.version = 'wrong'
  assert.throws(() => api.mapApiPrepared(preparation, changedMaterials))
  const session = rated(api.mapApiPrepared(preparation, materials))
  session.prepared.segments[0].text = 'Changed projection'
  assert.throws(() => domain.parseLecturerSession(session))
})

test('generation rejects mismatched identity/hash, invalid evidence/dimensions and altered backup originals', () => {
  const prepared = api.mapApiPrepared(preparation, materials)
  for (const mutate of [
    value => { value.condition = 'G2' },
    value => { value.document_id = 'other' },
    value => { value.provenance.rubric_sha256 = 'c'.repeat(64) },
    value => { value.output.feedback.strengths[0].evidence_segment_ids = ['unknown'] },
    value => { value.output.feedback.strengths[0].evidence_segment_ids = ['s1', 's1'] },
    value => { value.output.assessment.component_assessments[0].band = 1.5 },
    value => { value.output.evidence_synthesis[0].dimension_id = 'UA' },
  ]) {
    const value = generation('G1')
    mutate(value)
    assert.throws(() => api.mapApiGeneration(value, prepared, 'G1'))
  }
  let session = domain.beginAttempt(rated(prepared), 'G1', 'attempt')
  session = domain.finishAttempt(session, session.id, 'G1', 'attempt', { result: api.mapApiGeneration(generation('G1'), prepared, 'G1') })
  session.candidates.G1.result.items[0].text = 'Altered original'
  assert.throws(() => domain.parseLecturerSession(session))
  assert.throws(() => domain.parseLecturerSession({ ...rated(prepared), schema_version: '1.0.0' }))
  assert.throws(() => domain.parseLecturerSession({ ...domain.createLecturerSession(SYNTHETIC_CASE, 'demo'), schema_version: '1.1.0' }))
})

test('pending API restore becomes interrupted and late results remain ignored', () => {
  const pending = domain.beginAttempt(rated(api.mapApiPrepared(preparation, materials)), 'G1', 'old')
  const restored = domain.parseLecturerSession(pending)
  assert.equal(restored.candidates.G1.status, 'interrupted')
  assert.equal(domain.finishAttempt(restored, restored.id, 'G1', 'old', { result: {} }), restored)
})

test('API persistence roundtrips complete sessions without touching the demo namespace', async () => {
  const entries = new Map([['lecturer-workflow::synthetic::v1', domain.createLecturerSession(SYNTHETIC_CASE, 'demo')]])
  const localModule = join(dirname(process.env.PREBI_LECTURER_SESSION_MODULE), 'localSessions.js')
  require.cache[localModule] = {
    id: localModule, filename: localModule, loaded: true,
    exports: {
      async readSession(key) { return structuredClone(entries.get(key)) },
      async writeSession(key, value) { entries.set(key, structuredClone(value)) },
      async deleteSession(key) { entries.delete(key) },
    },
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key, action) => action() } } })
  const { LecturerPersistence } = require(process.env.PREBI_LECTURER_PERSISTENCE_MODULE)
  const storage = new LecturerPersistence('api')
  assert.equal(await storage.load(), null)
  const session = rated(api.mapApiPrepared(preparation, materials))
  await storage.save(session)
  assert.deepEqual(await new LecturerPersistence('api').load(), session)
  assert.deepEqual(entries.get('lecturer-workflow::synthetic::v1').prepared, SYNTHETIC_CASE)
  await storage.save(null)
  assert.equal(entries.size, 1)
})
