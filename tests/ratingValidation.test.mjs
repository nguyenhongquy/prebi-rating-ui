import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { answerError, canonicalJson, evaluationSteps, responseForDraft, submissionState } = await import(process.env.PREBI_RATING_VALIDATION_MODULE)
const packet = {
  packet_id: 'synthetic', task: 'assessment_quality', packet_version: '1.0.0',
  protocol_id: 'synthetic', protocol_version: '0.3.0', human_protocol: 'Original guide',
  condition_blinded: true, reflection: { segments: [] }, rubric: { version: 'test', dimensions: [] },
  criteria: [{ criterion_id: 'fit', label: 'Fit', description: 'Original description', anchors: { '1': 'Low', '2': 'Medium', '3': 'High' } }],
  scale: { min: 1, max: 3, anchors: {} }, output: { dimensions: [] },
}
const draft = {
  criterionRatings: { fit: { score: 2, unable_to_judge: false, comment: '' } },
  scoreAnswers: {}, overallComment: '', spanComments: [],
}
const impliedPacket = { ...packet, task: 'feedback_implied_score', score_dimensions: [{ dimension_id: 'SW', label: 'Dimension SW' }], human_feedback: 'Synthetic feedback' }
const impliedDraft = { ...draft, criterionRatings: {}, scoreAnswers: { SW: { status: 'not_inferable', score: null, confidence: 'not_inferable', rationale: 'No defensible score', feedback_evidence: [] } } }

test('step enumeration preserves IDs and packet order', () => {
  assert.deepEqual(evaluationSteps(packet), [{ id: 'fit', label: 'Fit' }])
  assert.deepEqual(evaluationSteps(impliedPacket), [{ id: 'SW', label: 'Dimension SW' }])
  assert.deepEqual(evaluationSteps({ ...packet, criteria: [] }), [])
})

test('quality rating must exist and fit the protocol scale', () => {
  assert.equal(answerError(packet, draft, 0), null)
  assert.match(answerError(packet, { ...draft, criterionRatings: {} }, 0), /Bewerten Sie Fit/)
  for (const score of [null, 0, 4, 2.5]) {
    assert.ok(answerError(packet, { ...draft, criterionRatings: { fit: { score, unable_to_judge: false, comment: '' } } }, 0))
  }
})

test('legacy five-point scales remain available', () => {
  const legacy = { ...packet, protocol_version: '0.1.0', scale: { min: 1, max: 5, anchors: {} } }
  assert.equal(answerError(legacy, { ...draft, criterionRatings: { fit: { score: 5, unable_to_judge: false, comment: '' } } }, 0), null)
})

test('unable-to-judge requires a nonblank reason', () => {
  const unable = { ...draft, criterionRatings: { fit: { score: null, unable_to_judge: true, comment: '  ' } } }
  assert.match(answerError(packet, unable, 0), /Begründen Sie, warum Fit/)
  assert.equal(answerError(packet, { ...unable, criterionRatings: { fit: { ...unable.criterionRatings.fit, comment: 'Reason' } } }, 0), null)
})

test('implied scores retain rationale and inferability requirements', () => {
  assert.equal(answerError(impliedPacket, impliedDraft, 0), null)
  const answer = impliedDraft.scoreAnswers.SW
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, rationale: '' } } }, 0), /Geben Sie eine Begründung/)
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, status: 'inferred_from_feedback' } } }, 0), /Ergänzen Sie den Punktwert und die Sicherheit/)
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, feedback_evidence: [{ start_character: 0, end_character: 9, quote: 'Synthetic' }] } } }, 0), /Entfernen Sie die Punktwertbelege/)
  assert.equal(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, status: 'inferred_from_feedback', score: 1.7, confidence: 'medium' } } }, 0), null)
})

test('quality response retains the exact research envelope', () => {
  assert.deepEqual(responseForDraft(packet, draft), { criterion_ratings: draft.criterionRatings, overall_comment: '', feedback_span_comments: [] })
})

test('implied-score response retains IDs, excerpts and offsets', () => {
  const answer = { ...impliedDraft.scoreAnswers.SW, status: 'inferred_from_feedback', score: 1.7, confidence: 'medium', feedback_evidence: [{ start_character: 0, end_character: 9, quote: 'Synthetic' }] }
  const withEvidence = { ...impliedDraft, scoreAnswers: { SW: answer } }
  assert.deepEqual(responseForDraft(impliedPacket, withEvidence), { scores: [{ dimension_id: 'SW', ...answer }], feedback_span_comments: [] })
})

test('packet states distinguish drafts, submissions and pending changes', () => {
  const response = responseForDraft(packet, draft)
  assert.equal(submissionState(packet, undefined, undefined), 'not_started')
  assert.equal(submissionState(packet, draft, undefined), 'draft')
  assert.equal(submissionState(packet, draft, response), 'submitted')
  assert.equal(submissionState(packet, undefined, response), 'submitted')
  assert.equal(submissionState(packet, { ...draft, overallComment: 'Edited' }, response), 'changed')
  assert.equal(submissionState(packet, { ...draft, spanComments: [{ comment: 'Edited span', linked_reflection_segment_ids: ['unchanged-id'] }] }, response), 'changed')
})

test('object key ordering does not create false pending edits', () => {
  const response = { feedback_span_comments: [], overall_comment: '', criterion_ratings: { fit: { comment: '', unable_to_judge: false, score: 2 } } }
  assert.equal(submissionState(packet, draft, response), 'submitted')
  assert.equal(canonicalJson({ second: 2, first: 1 }), '{"first":1,"second":2}')
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]))
})

const syntheticBundle = JSON.parse(readFileSync(new URL('../public/examples/synthetic-evaluation-bundle.json', import.meta.url), 'utf8'))

test('public synthetic evaluation bundle covers all tasks with valid source references', () => {
  assert.equal(syntheticBundle.synthetic, true)
  assert.deepEqual(syntheticBundle.packets.map(item => item.task).sort(), ['assessment_quality', 'feedback_implied_score', 'feedback_quality'])
  assert.equal(new Set(syntheticBundle.packets.map(item => item.packet_id)).size, syntheticBundle.packets.length)
  for (const item of syntheticBundle.packets) {
    assert.ok(item.packet_id.startsWith('synthetic-'))
    assert.ok(item.protocol_id.startsWith('synthetic-'))
    assert.equal(item.condition_blinded, true)
    assert.equal(item.packet_version, '1.0.0')
    assert.ok(item.human_protocol.trim())
    const segments = item.reflection.segments
    const ids = new Set(segments.map(segment => segment.segment_id))
    assert.equal(ids.size, segments.length)
    assert.deepEqual(segments.map(segment => segment.order), [0, 1, 2])
    assert.ok(segments.every(segment => segment.text.trim() && segment.segment_id.startsWith('synthetic-')))
    assert.deepEqual(item.rubric.dimensions.map(dimension => dimension.dimension_id), ['SW', 'UA', 'HA'])
    for (const output of Object.values(item.output ?? {}).flat()) {
      assert.ok(output.evidence_segment_ids.length)
      assert.ok(output.evidence_segment_ids.every(id => ids.has(id)))
    }
    if (item.task === 'feedback_implied_score') {
      assert.ok(item.human_feedback.trim())
      assert.deepEqual(item.score_dimensions.map(dimension => dimension.dimension_id), ['SW', 'UA', 'HA'])
    } else {
      assert.equal(item.scale.min, 1)
      assert.equal(item.scale.max, 3)
      assert.ok(item.criteria.length > 1)
      for (const criterion of item.criteria) assert.deepEqual(Object.keys(criterion.anchors), ['1', '2', '3'])
      if (item.task === 'assessment_quality') {
        assert.deepEqual(item.output.dimensions.map(dimension => dimension.dimension_id), ['SW', 'UA', 'HA'])
        assert.ok(item.output.dimensions.every(dimension => Number.isFinite(dimension.score) && dimension.score >= 0 && dimension.score <= 3 && dimension.justification.trim()))
      } else {
        for (const component of ['strengths', 'weaknesses', 'suggestions']) assert.ok(item.output[component].every(output => output.text.trim()))
      }
    }
  }
})

test('synthetic evaluation packets support complete valid responses', () => {
  for (const item of syntheticBundle.packets) {
    const completeDraft = {
      criterionRatings: Object.fromEntries((item.criteria ?? []).map(criterion => [criterion.criterion_id, { score: 2, unable_to_judge: false, comment: '' }])),
      scoreAnswers: Object.fromEntries((item.score_dimensions ?? []).map(dimension => [dimension.dimension_id, { status: 'not_inferable', score: null, confidence: 'not_inferable', rationale: 'Synthetische Testantwort.', feedback_evidence: [] }])),
      overallComment: '', spanComments: [],
    }
    for (const [index] of evaluationSteps(item).entries()) assert.equal(answerError(item, completeDraft, index), null)
    assert.equal(submissionState(item, completeDraft, responseForDraft(item, completeDraft)), 'submitted')
  }
})