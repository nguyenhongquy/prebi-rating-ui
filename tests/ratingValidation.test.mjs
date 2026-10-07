import assert from 'node:assert/strict'
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
  assert.match(answerError(packet, { ...draft, criterionRatings: {} }, 0), /Rate Fit/)
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
  assert.match(answerError(packet, unable, 0), /Explain why Fit/)
  assert.equal(answerError(packet, { ...unable, criterionRatings: { fit: { ...unable.criterionRatings.fit, comment: 'Reason' } } }, 0), null)
})

test('implied scores retain rationale and inferability requirements', () => {
  assert.equal(answerError(impliedPacket, impliedDraft, 0), null)
  const answer = impliedDraft.scoreAnswers.SW
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, rationale: '' } } }, 0), /Add a rationale/)
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, status: 'inferred_from_feedback' } } }, 0), /Complete the score and confidence/)
  assert.match(answerError(impliedPacket, { ...impliedDraft, scoreAnswers: { SW: { ...answer, feedback_evidence: [{ start_character: 0, end_character: 9, quote: 'Synthetic' }] } } }, 0), /Remove score evidence/)
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