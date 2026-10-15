import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { validateEvaluationBundle, caseCompletion, pairCandidates, humanAnnotationBand } = require(process.env.PREBI_PAIRWISE_VALIDATION_MODULE)
const { confirmReferenceScores, createEvaluationSession, researchExport, setExplanation, setPairPreference, setReferenceComment, setReferenceScore, setReleaseDecision, validateEvaluationSession } = require(process.env.PREBI_PAIRWISE_SESSION_MODULE)
const example = JSON.parse(readFileSync(new URL('../public/pairwise-evaluation-example.json', import.meta.url), 'utf8'))

function scoreReference(session, caseId, now = '2026-10-15T10:00:30.000Z') {
  session = setReferenceScore(session, caseId, 'SW', 2.5, now)
  session = setReferenceScore(session, caseId, 'UA', 1.5, now)
  session = setReferenceScore(session, caseId, 'HA', 0, now)
  return confirmReferenceScores(session, caseId, now)
}

function createCompletedFirstCase() {
  const bundle = validateEvaluationBundle(example)
  let session = createEvaluationSession(bundle, 'expert-01', 'a'.repeat(64), '2026-10-15T10:00:00.000Z')
  const currentCase = bundle.cases[0]
  const [first, second] = pairCandidates(currentCase.display_order, 'A-B')
  const [a, b, c] = currentCase.candidates.map(candidate => candidate.candidate_id)
  session = setReferenceComment(session, currentCase.case_id, 'UA', 'Ursachen nur angedeutet.', '2026-10-15T10:00:20.000Z')
  session = scoreReference(session, currentCase.case_id)
  session = setReleaseDecision(session, currentCase.case_id, a, 'ready', '2026-10-15T10:01:00.000Z')
  session = setReleaseDecision(session, currentCase.case_id, b, 'edit', '2026-10-15T10:02:00.000Z')
  session = setReleaseDecision(session, currentCase.case_id, c, 'reject', '2026-10-15T10:03:00.000Z')
  session = setExplanation(session, currentCase.case_id, b, 'Bitte konkreter formulieren.', '2026-10-15T10:04:00.000Z')
  session = setPairPreference(session, currentCase.case_id, 'A-B', 'first', '2026-10-15T10:05:00.000Z')
  session = setPairPreference(session, currentCase.case_id, 'A-C', 'second', '2026-10-15T10:06:00.000Z')
  session = setPairPreference(session, currentCase.case_id, 'B-C', 'tie', '2026-10-15T10:07:00.000Z')
  return { session, first, second, currentCase }
}

test('synthetic bundle has three fictional cases, stable blinded orders, and long feedback', () => {
  const bundle = validateEvaluationBundle(example)
  assert.equal(bundle.cases.length, 3)
  assert.notDeepEqual(bundle.cases[0].display_order, bundle.cases[1].display_order)
  assert.notDeepEqual(bundle.cases[1].display_order, bundle.cases[2].display_order)
  assert.ok(bundle.cases[2].candidates.some(candidate => candidate.feedback.suggestions?.[0].text.length > 400))
  assert.ok(bundle.cases.every(item => item.candidates.length === 3))
  assert.ok(bundle.cases.every(item => item.human_annotations.length > 0 && item.segment_summary.dimensions.length > 0))
  for (const evaluationCase of bundle.cases) {
    for (const candidate of evaluationCase.candidates) {
      for (const items of Object.values(candidate.feedback)) {
        assert.ok(items.every(item => Array.isArray(item.evidence_segment_ids)))
      }
    }
  }
})

test('bundle validator rejects unsupported, malformed, unblinded and incomplete material', () => {
  assert.throws(() => validateEvaluationBundle({ ...example, schema_version: '1.0.0' }), /nicht unterstützt/)
  assert.throws(() => validateEvaluationBundle({ ...example, model_name: 'hidden' }), /geschützte/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], judge_output: 'hidden' }] }), /geschützte/)
  assert.throws(() => validateEvaluationBundle({ ...example, historical_feedback: 'hidden' }), /geschützte/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: example.cases[0].candidates.slice(0, 2) }] }), /genau drei/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], case_id: example.cases[1].case_id }, example.cases[1], example.cases[2]] }), /Fall-IDs müssen eindeutig sein/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: [example.cases[0].candidates[0], example.cases[0].candidates[0], example.cases[0].candidates[2]] }] }), /doppelte Kandidaten/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: [{ ...example.cases[0].candidates[0], candidate_id: 'G1' }, ...example.cases[0].candidates.slice(1)], display_order: { A: 'G1', B: 'feedback-42', C: 'feedback-83' } }, ...example.cases.slice(1)] }), /keine experimentellen Bedingungen/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: [{ ...example.cases[0].candidates[0], candidate_id: 'model-gpt-4' }, ...example.cases[0].candidates.slice(1)], display_order: { A: 'model-gpt-4', B: 'feedback-42', C: 'feedback-83' } }, ...example.cases.slice(1)] }), /keine experimentellen Bedingungen/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], display_order: { A: 'feedback-17', B: 'feedback-42', C: 'not-in-case' } }] }), /genau einmal/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: [{ ...example.cases[0].candidates[0], feedback: {} }, ...example.cases[0].candidates.slice(1)] }] }), /mindestens einen/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], human_annotations: [{ ...example.cases[0].human_annotations[0], skill_label: '' }] }, ...example.cases.slice(1)] }), /Skill-Label und Level/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], human_annotations: [{ ...example.cases[0].human_annotations[0], segment_id: 'unknown' }] }, ...example.cases.slice(1)] }), /unbekanntes Segment/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], segment_summary: { ...example.cases[0].segment_summary, dimensions: [{ ...example.cases[0].segment_summary.dimensions[0], mean_positive_band: 1.5 }] } }, ...example.cases.slice(1)] }), /deskriptive Segmentdimension/)
  assert.throws(() => validateEvaluationBundle({ ...example, cases: [{ ...example.cases[0], candidates: [{ ...example.cases[0].candidates[0], feedback: { strengths: [{ text: 'Text', evidence_segment_ids: ['unknown'] }] } }, ...example.cases[0].candidates.slice(1)] }, ...example.cases.slice(1)] }), /unbekanntes Reflexionssegment/)
})

test('completion requires confirmed reference scores, three release decisions and all three preferences; a tie is complete', () => {
  const dims = ['SW', 'UA', 'HA']
  const scores = { SW: 3, UA: 0.5, HA: 0 }
  const decisions = { release_readiness: { a: 'ready', b: 'edit', c: 'reject' }, pairwise_preferences: { 'A-B': 'first', 'A-C': 'second', 'B-C': 'tie' } }
  assert.deepEqual(caseCompletion({ reference_scores: scores, reference_confirmed_at: '2026-10-15T10:00:00.000Z', ...decisions }, ['a', 'b', 'c'], dims), { complete: true, referenceConfirmed: true, decisions: 9, total: 9 })
  assert.deepEqual(caseCompletion({ reference_scores: scores, ...decisions }, ['a', 'b', 'c'], dims), { complete: false, referenceConfirmed: false, decisions: 9, total: 9 })
  assert.deepEqual(caseCompletion({ reference_scores: { SW: 3, UA: 1.25 }, reference_confirmed_at: '2026-10-15T10:00:00.000Z', release_readiness: { a: 'ready', b: 'edit', c: 'unknown' }, pairwise_preferences: { 'A-B': 'first', 'A-C': 'tie' } }, ['a', 'b', 'c'], dims), { complete: false, referenceConfirmed: false, decisions: 5, total: 9 })
  let session = createEvaluationSession(validateEvaluationBundle(example), 'expert-01', 'c'.repeat(64))
  session = scoreReference(session, 'case-001')
  assert.throws(() => setReleaseDecision(session, 'case-001', 'feedback-17', 'unknown'), /ungültige Freigabeentscheidung/)
})

test('bundle carries the reference protocol and rubric anchors without generated assessments', () => {
  const bundle = validateEvaluationBundle(example)
  assert.equal(bundle.schema_version, '1.2.0')
  assert.equal(bundle.reference_scoring.protocol_id, 'reflection_reference_score_human')
  assert.equal(bundle.reference_scoring.protocol_version, '0.2.0')
  assert.match(bundle.reference_scoring.human_protocol, /Kommentar \(optional\)/)
  assert.deepEqual(bundle.reference_scoring.scale, { min: 0, max: 3, step: 0.5 })
  assert.deepEqual(bundle.reference_scoring.dimensions.map(item => item.dimension_id), ['SW', 'UA', 'HA'])
  assert.ok(bundle.reference_scoring.dimensions.every(item => Object.keys(item.bands).join() === '0,1,2,3'))
  assert.throws(() => validateEvaluationBundle({ ...example, reference_scoring: undefined }), /Referenzbewertung/)
  assert.throws(() => validateEvaluationBundle({ ...example, reference_scoring: { ...example.reference_scoring, scale: { min: 0, max: 3, step: 1 } } }), /Schritten von 0,5/)
  assert.throws(() => validateEvaluationBundle({ ...example, reference_scoring: { ...example.reference_scoring, dimensions: [{ ...example.reference_scoring.dimensions[0], bands: { 0: 'a', 1: 'b', 2: 'c' } }] } }), /Rubrikanker/)
  assert.throws(() => validateEvaluationBundle({ ...example, reference_scoring: { ...example.reference_scoring, generated_assessment: 'hidden' } }), /geschützte|Referenzbewertung/)
})

test('reference scoring validates half-point scores, keeps comments optional, and locks after confirmation', () => {
  let session = createEvaluationSession(validateEvaluationBundle(example), 'expert-01', 'd'.repeat(64), '2026-10-15T10:00:00.000Z')
  for (const invalid of [-0.5, 3.5, 1.25, Number.NaN]) assert.throws(() => setReferenceScore(session, 'case-001', 'SW', invalid), /Schritten von 0,5/)
  assert.throws(() => setReferenceScore(session, 'case-001', 'XX', 1), /Unbekannte Dimension/)
  assert.throws(() => setReleaseDecision(session, 'case-001', 'feedback-17', 'ready'), /zuerst die Referenzbewertung/)
  assert.throws(() => setPairPreference(session, 'case-001', 'A-B', 'tie'), /zuerst die Referenzbewertung/)
  assert.throws(() => setExplanation(session, 'case-001', 'feedback-17', 'x'), /zuerst die Referenzbewertung/)
  session = setReferenceScore(session, 'case-001', 'SW', 2)
  session = setReferenceScore(session, 'case-001', 'UA', 1)
  assert.throws(() => confirmReferenceScores(session, 'case-001'), /alle drei Dimensionen/)
  session = setReferenceScore(session, 'case-001', 'UA', null)
  assert.equal(session.responses['case-001'].reference_scores.UA, undefined)
  session = setReferenceScore(session, 'case-001', 'UA', 1)
  session = setReferenceScore(session, 'case-001', 'HA', 3)
  session = setReferenceComment(session, 'case-001', 'HA', 'Klar begründete Alternativen.')
  session = setReferenceComment(session, 'case-001', 'SW', 'temp')
  session = setReferenceComment(session, 'case-001', 'SW', '')
  assert.deepEqual(session.responses['case-001'].reference_comments, { HA: 'Klar begründete Alternativen.' })
  session = confirmReferenceScores(session, 'case-001', '2026-10-15T10:05:00.000Z')
  assert.equal(session.responses['case-001'].reference_confirmed_at, '2026-10-15T10:05:00.000Z')
  assert.throws(() => setReferenceScore(session, 'case-001', 'SW', 3), /bereits abgeschlossen/)
  assert.throws(() => setReferenceComment(session, 'case-001', 'SW', 'späte Änderung'), /bereits abgeschlossen/)
  assert.equal(confirmReferenceScores(session, 'case-001'), session)
  session = setReleaseDecision(session, 'case-001', 'feedback-17', 'ready')
  assert.equal(session.responses['case-001'].release_readiness['feedback-17'], 'ready')
})

test('responses preserve candidate assignments and allow non-transitive preferences without resolving them', () => {
  const bundle = validateEvaluationBundle(example)
  const evaluationCase = bundle.cases[0]
  const [first, second] = pairCandidates(evaluationCase.display_order, 'A-B')
  let session = createEvaluationSession(bundle, 'expert-01', 'b'.repeat(64), '2026-10-15T10:00:00.000Z')
  session = scoreReference(session, evaluationCase.case_id)
  session = setReleaseDecision(session, evaluationCase.case_id, first, 'ready', '2026-10-15T10:01:00.000Z')
  session = setPairPreference(session, evaluationCase.case_id, 'A-B', 'first', '2026-10-15T10:02:00.000Z')
  session = setPairPreference(session, evaluationCase.case_id, 'A-C', 'second', '2026-10-15T10:03:00.000Z')
  session = setPairPreference(session, evaluationCase.case_id, 'B-C', 'first', '2026-10-15T10:04:00.000Z')
  assert.equal(session.responses[evaluationCase.case_id].pairwise_preferences['A-B'], 'first')
  assert.equal(session.responses[evaluationCase.case_id].pairwise_preferences['A-C'], 'second')
  assert.equal(session.responses[evaluationCase.case_id].pairwise_preferences['B-C'], 'first')
  assert.deepEqual(pairCandidates(evaluationCase.display_order, 'A-B'), [first, second])
})

test('session persistence restore validates response references and keeps presentation order', () => {
  const { session } = createCompletedFirstCase()
  const restored = validateEvaluationSession(JSON.parse(JSON.stringify(session)))
  assert.deepEqual(restored.input_bundle.cases[0].display_order, session.input_bundle.cases[0].display_order)
  assert.deepEqual(restored.responses, session.responses)
  assert.equal(restored.completed_at, null)
  const corrupted = structuredClone(session)
  corrupted.responses['case-001'].release_readiness['unknown-candidate'] = 'ready'
  assert.throws(() => validateEvaluationSession(corrupted), /Freigabeentscheidung/)
  const incompleteWithTime = structuredClone(session)
  incompleteWithTime.responses['case-002'].completed_at = '2026-10-15T10:07:00.000Z'
  assert.throws(() => validateEvaluationSession(incompleteWithTime), /Unvollständiger Fall/)
  const badScore = structuredClone(session)
  badScore.responses['case-002'].reference_scores.SW = 1.25
  assert.throws(() => validateEvaluationSession(badScore), /Referenzbewertung für Fall case-002/)
  const unconfirmedWithDecisions = structuredClone(session)
  delete unconfirmedWithDecisions.responses['case-001'].reference_confirmed_at
  assert.throws(() => validateEvaluationSession(unconfirmedWithDecisions), /vor der bestätigten Referenzbewertung/)
  const confirmedIncomplete = structuredClone(session)
  delete confirmedIncomplete.responses['case-001'].reference_scores.HA
  assert.throws(() => validateEvaluationSession(confirmedIncomplete), /unvollständig/)
  const legacy = structuredClone(session)
  legacy.schema_version = '1.1.0'
  assert.throws(() => validateEvaluationSession(legacy), /nicht unterstütztes Protokoll/)
})

test('research export includes completed cases only, preserves ids, and distinguishes explicit ties', () => {
  const { session, first, second, currentCase } = createCompletedFirstCase()
  const complete = {
    ...session,
    responses: {
      ...session.responses,
      [currentCase.case_id]: {
        ...session.responses[currentCase.case_id],
        release_readiness: Object.fromEntries(currentCase.candidates.map((candidate, index) => [candidate.candidate_id, ['ready', 'edit', 'reject'][index]])),
        completed_at: '2026-10-15T10:07:00.000Z',
      },
    },
    completed_at: null,
  }
  const exportData = researchExport(complete)
  assert.equal(exportData.schema_version, '1.2.0')
  assert.deepEqual(exportData.reference_score_protocol, { protocol_id: 'reflection_reference_score_human', protocol_version: '0.2.0', rubric_version: example.reference_scoring.rubric_version })
  assert.deepEqual(exportData.cases[0].reference_scores, { SW: { score: 2.5 }, UA: { score: 1.5, comment: 'Ursachen nur angedeutet.' }, HA: { score: 0 } })
  assert.equal(exportData.cases[0].reference_confirmed_at, '2026-10-15T10:00:30.000Z')
  assert.equal(exportData.protocol_id, 'prebi_blinded_feedback_preference')
  assert.equal(exportData.completion_status, 'in_progress')
  assert.equal(exportData.completed_case_count, 1)
  assert.equal(exportData.cases.length, 1)
  assert.deepEqual(exportData.cases[0].display_order, currentCase.display_order)
  assert.equal(exportData.cases[0].release_readiness[first], 'ready')
  assert.ok([first, second].includes(exportData.cases[0].pairwise_preferences[0].candidate_1))
  assert.equal(exportData.cases[0].pairwise_preferences[2].preference, 'tie')
  assert.equal(exportData.cases[0].pairwise_preferences[2].preferred_candidate_id, null)
  assert.equal(exportData.cases[0].explanations[second], 'Bitte konkreter formulieren.')
})

test('a completed session is marked complete only after every case has reference scores and six decisions', () => {
  let { session } = createCompletedFirstCase()
  for (const evaluationCase of session.input_bundle.cases.slice(1)) {
    session = scoreReference(session, evaluationCase.case_id)
    for (const candidate of evaluationCase.candidates) session = setReleaseDecision(session, evaluationCase.case_id, candidate.candidate_id, 'ready')
    for (const pair of ['A-B', 'A-C', 'B-C']) session = setPairPreference(session, evaluationCase.case_id, pair, 'tie')
  }
  assert.equal(session.completed_at, session.updated_at)
  assert.equal(researchExport(session).completion_status, 'complete')
  const restored = validateEvaluationSession(session)
  assert.equal(restored.completed_at, session.completed_at)
  assert.equal(researchExport(restored).completed_case_count, 3)
})

test('reflection chips show skill label and lettered non-zero band only, with summary before reflection', () => {
  assert.equal(humanAnnotationBand('Band 1'), 'Band A')
  assert.equal(humanAnnotationBand('Band 2'), 'Band B')
  assert.equal(humanAnnotationBand('Band 3'), 'Band C')
  assert.equal(humanAnnotationBand('Band 2 (prüfbedürftig)'), 'Band B (prüfbedürftig)')
  assert.equal(humanAnnotationBand('Band 0'), null)
  assert.equal(humanAnnotationBand('Band 0 (prüfbedürftig)'), null)
  assert.equal(humanAnnotationBand('unbekannt'), null)
  const viewer = readFileSync(new URL('../src/SourceComparison.tsx', import.meta.url), 'utf8')
  const chip = viewer.match(/human-segment-annotations[^\n]*/)[0]
  assert.match(chip, /annotation-\$\{annotation\.dimension_id\.toLowerCase\(\)\}/)
  assert.match(chip, /<strong>\{annotation\.skill_label\}<\/strong><small>\{annotation\.band\}<\/small><\/li>/)
  const workbench = readFileSync(new URL('../src/PairwiseEvaluationWorkbench.tsx', import.meta.url), 'utf8')
  assert.ok(workbench.indexOf('<SegmentSummaryPanel') < workbench.indexOf('<ReflectionViewer'))
  assert.match(workbench, /title="Deskriptive Segmentinformationen" variant="pairwise"/)
  const summary = readFileSync(new URL('../src/SegmentSummaryPanel.tsx', import.meta.url), 'utf8')
  assert.match(summary, /Segmente mit Band A–C/)
  assert.match(summary, /\{!pairwise && <th>Verschiedene zugeordnete Segmente<\/th>\}/)
  assert.doesNotMatch(workbench, /PReBI/)
})
