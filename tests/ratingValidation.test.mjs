import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { answerError, canonicalJson, evaluationSteps, responseForDraft, submissionState, emptyDraft, caseState, isValidReferenceScore, parseReferenceScoreInput, referenceAnchorScores, segmentDisplayNumbers, visibleModellingBands, REFERENCE_SCORE_SCALE } = await import(process.env.PREBI_RATING_VALIDATION_MODULE)
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

test('segment display numbering supports zero-based and one-based packet orders', () => {
  assert.deepEqual([...segmentDisplayNumbers([
    { segment_id: 'zero-a', order: 0, text: 'A' },
    { segment_id: 'zero-b', order: 1, text: 'B' },
  ])], [['zero-a', 1], ['zero-b', 2]])
  assert.deepEqual([...segmentDisplayNumbers([
    { segment_id: 'one-a', order: 1, text: 'A' },
    { segment_id: 'one-b', order: 2, text: 'B' },
  ])], [['one-a', 1], ['one-b', 2]])
})

test('Task A modelling references show only known non-zero SW, UA, and HA bands', () => {
  const displayed = visibleModellingBands([
    { segment_id: 'seg', dimension_id: 'SW', level: '0', known: true },
    { segment_id: 'seg', dimension_id: 'UA', level: '2', known: true },
    { segment_id: 'seg', dimension_id: 'HA', level: '3', known: false },
  ], { SW: 'Situationswahrnehmung', UA: 'Ursachenanalyse', HA: 'Handlungsalternativen' })
  assert.deepEqual(displayed, [
    { dimension_id: 'UA', label: 'Ursachenanalyse', band: '2' },
  ])
  assert.ok(displayed.every(item => item.band !== '0'))
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

test('case completion follows current responses without explicit submission', () => {
  assert.equal(caseState(packet, undefined), 'not_started')
  assert.equal(caseState(packet, emptyDraft(packet)), 'not_started')
  assert.equal(caseState(packet, draft), 'complete')
  assert.equal(caseState(packet, { ...draft, criterionRatings: { fit: { score: null, unable_to_judge: true, comment: '' } } }), 'in_progress')
  assert.equal(caseState(packet, { ...draft, criterionRatings: { fit: { score: null, unable_to_judge: true, comment: 'Grund' } } }), 'complete')
})

test('unanswered dimensions remain distinct from intentionally not inferable', () => {
  const initial = emptyDraft(impliedPacket)
  assert.equal(initial.scoreAnswers.SW.status, 'unanswered')
  assert.equal(initial.scoreAnswers.SW.score, null)
  assert.equal(caseState(impliedPacket, initial), 'not_started')
  assert.equal(caseState(impliedPacket, impliedDraft), 'complete')
  for (const score of [-0.1, 3.1, 1.75, NaN]) {
    const invalid = { ...impliedDraft, scoreAnswers: { SW: { ...impliedDraft.scoreAnswers.SW, status: 'inferred_from_feedback', confidence: 'medium', score } } }
    assert.ok(answerError(impliedPacket, invalid, 0))
    assert.equal(caseState(impliedPacket, invalid), 'in_progress')
  }
})

const syntheticBundle = JSON.parse(readFileSync(new URL('../public/examples/synthetic-evaluation-bundle.json', import.meta.url), 'utf8'))
const referencePacket = syntheticBundle.packets.find(item => item.task === 'reflection_reference_score')

test('reference score validation accepts seven half steps and distinguishes null from zero', () => {
  for (const score of [0, 0.5, 1, 1.5, 2, 2.5, 3]) assert.equal(isValidReferenceScore(score), true)
  for (const score of [-0.5, 3.5, 2.1, 2.9, 1.75, NaN, Infinity, '2.5']) assert.equal(isValidReferenceScore(score), false)
  assert.deepEqual(parseReferenceScoreInput(''), { score: null, valid: true })
  assert.deepEqual(parseReferenceScoreInput('2,5'), { score: 2.5, valid: true })
  assert.equal(parseReferenceScoreInput('2.1').valid, false)
  assert.equal(parseReferenceScoreInput('invalid').valid, false)
  assert.equal(REFERENCE_SCORE_SCALE.step, 0.5)
  const initial = emptyDraft(referencePacket)
  assert.equal(initial.referenceAnswers.SW.score, null)
  assert.match(answerError(referencePacket, initial, 0), /Punktwert/)
  initial.referenceAnswers.SW.score = 0
  assert.equal(answerError(referencePacket, initial, 0), null)
})

test('reference rubric anchors select exact or surrounding levels and UI controls share the score setter', () => {
  assert.deepEqual(referenceAnchorScores(1.5, [0, 1, 2, 3]), [1, 2])
  assert.deepEqual(referenceAnchorScores(2.5, [0, 1, 2, 3]), [2, 3])
  assert.deepEqual(referenceAnchorScores(3, [0, 1, 2, 3]), [3])
  const source = readFileSync(new URL('../src/RatingWorkbench.tsx', import.meta.url), 'utf8')
  assert.match(source, /type="range" min=\{scale\.min\} max=\{scale\.max\} step=\{scale\.step/)
  assert.match(source, /onChange=\{event => setReferenceScore\(Number\(event\.currentTarget\.value\)\)\}/)
  assert.match(source, /onChange=\{event => editReferenceScore\(event\.currentTarget\.value\)\}/)
  assert.match(source, /selectedAnchors\.has\(Number\(score\)\)/)
})

test('public synthetic evaluation bundle covers all tasks with valid source references', () => {
  assert.equal(syntheticBundle.synthetic, true)
  assert.deepEqual(syntheticBundle.packets.map(item => item.task).sort(), ['assessment_quality', 'feedback_implied_score', 'feedback_quality', 'reflection_reference_score'])
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
    if (item.task === 'reflection_reference_score') {
      assert.deepEqual(item.score_dimensions.map(dimension => dimension.dimension_id), ['SW', 'UA', 'HA'])
      assert.ok(item.segment_annotations.some(annotation => annotation.segment_id === 'synthetic-reference-segment-2' && annotation.dimension_id === 'SW'))
      assert.ok(item.segment_annotations.some(annotation => annotation.segment_id === 'synthetic-reference-segment-2' && annotation.dimension_id === 'UA'))
      assert.equal(Object.hasOwn(item, 'output'), false)
      assert.equal(Object.hasOwn(item, 'human_feedback'), false)
    } else if (item.task === 'feedback_implied_score') {
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
    const completeDraft = emptyDraft(item)
    for (const criterion of item.criteria ?? []) completeDraft.criterionRatings[criterion.criterion_id].score = 2
    for (const answer of Object.values(completeDraft.scoreAnswers)) Object.assign(answer, { status: 'not_inferable', rationale: 'Synthetische Testantwort.' })
    for (const answer of Object.values(completeDraft.referenceAnswers)) answer.score = 0
    for (const [index] of evaluationSteps(item).entries()) assert.equal(answerError(item, completeDraft, index), null)
    assert.equal(submissionState(item, completeDraft, responseForDraft(item, completeDraft)), 'submitted')
    if (item.task === 'reflection_reference_score') assert.ok(responseForDraft(item, completeDraft).scores.every(answer => answer.score === 0 && !Object.hasOwn(answer, 'confidence')))
  }
})

test('reference scoring omits the generated-output viewer', () => {
  const source = readFileSync(new URL('../src/SourceComparison.tsx', import.meta.url), 'utf8')
  assert.match(source, /const reflectionOnly = packet\.task === 'reflection_reference_score'/)
  assert.match(source, /!reflectionOnly && <OutputViewer/)
  assert.doesNotMatch(source, /annotation\.skill_label/)
  assert.ok(referencePacket.segment_annotations.every(annotation => !Object.hasOwn(annotation, 'skill_label')))
})