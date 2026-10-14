import type { Draft, Packet, Segment, SegmentAnnotation } from './ratingTypes'

export type PacketState = 'not_started' | 'draft' | 'changed' | 'submitted'
export type CaseState = 'not_started' | 'in_progress' | 'complete'

export const REFERENCE_SCORE_SCALE = { id: 'reflection-reference-0-3-step-0.5-v1', min: 0, max: 3, step: 0.5 } as const

export function segmentDisplayNumbers(segments: Segment[]): Map<string, number> {
  const firstOrder = segments.length ? Math.min(...segments.map(segment => segment.order)) : 0
  const offset = firstOrder === 0 ? 1 : 0
  return new Map(segments.map(segment => [segment.segment_id, segment.order + offset]))
}

export function visibleModellingBands(
  annotations: SegmentAnnotation[],
  dimensionLabels: Record<string, string>,
): Array<{ dimension_id: string; label: string; band: string }> {
  const byDimension = new Map(annotations.map(annotation => [annotation.dimension_id, annotation]))
  return (['SW', 'UA', 'HA'] as const).flatMap(dimensionId => {
    const annotation = byDimension.get(dimensionId)
    const band = annotation?.level?.trim() ?? ''
    if (!annotation || annotation.known === false || !/^[1-3]$/.test(band)) return []
    return [{ dimension_id: dimensionId, label: dimensionLabels[dimensionId] ?? dimensionId, band: ({ '1': 'A', '2': 'B', '3': 'C' } as Record<string, string>)[band] }]
  })
}

export function isValidReferenceScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= REFERENCE_SCORE_SCALE.min
    && value <= REFERENCE_SCORE_SCALE.max
    && Math.abs(value / REFERENCE_SCORE_SCALE.step - Math.round(value / REFERENCE_SCORE_SCALE.step)) < 1e-8
}

export function parseReferenceScoreInput(value: string): { score: number | null; valid: boolean } {
  const trimmed = value.trim()
  if (!trimmed) return { score: null, valid: true }
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) return { score: null, valid: false }
  const score = Number(trimmed.replace(',', '.'))
  return isValidReferenceScore(score) ? { score, valid: true } : { score: null, valid: false }
}

export function referenceAnchorScores(score: number | null, anchors: number[]): number[] {
  if (score === null || !isValidReferenceScore(score)) return []
  const ordered = [...anchors].filter(Number.isFinite).sort((left, right) => left - right)
  if (ordered.includes(score)) return [score]
  const lower = ordered.filter(anchor => anchor < score).at(-1)
  const upper = ordered.find(anchor => anchor > score)
  return [lower, upper].filter((anchor): anchor is number => anchor !== undefined)
}

export function emptyDraft(packet: Packet): Draft {
  return {
    criterionRatings: Object.fromEntries((packet.criteria ?? []).map(item => [item.criterion_id, { score: null, unable_to_judge: false, comment: '' }])),
    scoreAnswers: Object.fromEntries((packet.task === 'feedback_implied_score' ? packet.score_dimensions ?? [] : []).map(item => [item.dimension_id, { status: 'unanswered', score: null, confidence: 'not_inferable', rationale: '', feedback_evidence: [] }])),
    referenceAnswers: Object.fromEntries((packet.task === 'reflection_reference_score' ? packet.score_dimensions ?? [] : []).map(item => [item.dimension_id, { score: null, rationale: '', evidence_segment_ids: [] }])),
    overallComment: '',
    spanComments: [],
  }
}

export function caseState(packet: Packet, draft: Draft | undefined): CaseState {
  if (!draft) return 'not_started'
  const started = Boolean(draft.overallComment.trim() || draft.spanComments.length
    || Object.values(draft.criterionRatings).some(answer => answer.score !== null || answer.unable_to_judge || answer.comment.trim())
    || Object.values(draft.scoreAnswers).some(answer => answer.status !== 'unanswered' || answer.rationale.trim() || answer.feedback_evidence.length)
    || Object.values(draft.referenceAnswers).some(answer => answer.score !== null || answer.rationale.trim() || answer.evidence_segment_ids.length))
  if (!started) return 'not_started'
  const steps = evaluationSteps(packet)
  return steps.length > 0 && steps.every((_, index) => !answerError(packet, draft, index)) ? 'complete' : 'in_progress'
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function responseForDraft(packet: Packet, draft: Draft) {
  if (packet.task === 'reflection_reference_score') {
    return { scores: (packet.score_dimensions ?? []).map(({ dimension_id }) => ({ dimension_id, ...draft.referenceAnswers[dimension_id] })) }
  }
  return packet.task === 'feedback_implied_score'
    ? { scores: Object.entries(draft.scoreAnswers).map(([dimension_id, answer]) => ({ dimension_id, ...answer })), feedback_span_comments: draft.spanComments }
    : { criterion_ratings: draft.criterionRatings, overall_comment: draft.overallComment, feedback_span_comments: draft.spanComments }
}

export function submissionState(packet: Packet, draft: Draft | undefined, response: unknown | undefined): PacketState {
  if (response === undefined) return draft ? 'draft' : 'not_started'
  if (draft && canonicalJson(response) !== canonicalJson(responseForDraft(packet, draft))) return 'changed'
  return 'submitted'
}

export function evaluationSteps(packet: Packet) {
  return packet.task === 'feedback_implied_score' || packet.task === 'reflection_reference_score'
    ? (packet.score_dimensions ?? []).map(dimension => ({ id: dimension.dimension_id, label: dimension.label }))
    : (packet.criteria ?? []).map(criterion => ({ id: criterion.criterion_id, label: criterion.label }))
}

export function answerError(packet: Packet, draft: Draft, index: number): string | null {
  if (packet.task === 'reflection_reference_score') {
    const dimension = packet.score_dimensions?.[index]
    if (!dimension) return null
    const answer = draft.referenceAnswers[dimension.dimension_id]
    const rubricDimension = packet.rubric.dimensions.find(item => item.dimension_id === dimension.dimension_id)
    if (!answer || answer.score === null) return `Wählen Sie für ${dimension.label} einen Punktwert.`
    if (!isValidReferenceScore(answer.score)) return `Wählen Sie für ${dimension.label} einen Punktwert von 0,0 bis 3,0 in Schritten von 0,5.`
    if (!rubricDimension) return `Wählen Sie für ${dimension.label} einen Punktwert aus dem Bewertungsraster.`
    return null
  }
  if (packet.task === 'feedback_implied_score') {
    const dimension = packet.score_dimensions?.[index]
    if (!dimension) return null
    const answer = draft.scoreAnswers[dimension.dimension_id]
    if (answer?.status === 'unanswered') return `Wählen Sie für ${dimension.label}, ob ein Punktwert ableitbar ist.`
    if (!answer || !answer.rationale.trim()) return `Geben Sie eine Begründung für ${dimension.label} an.`
    if (answer.status === 'inferred_from_feedback' && (answer.score === null || answer.confidence === 'not_inferable')) return `Ergänzen Sie den Punktwert und die Sicherheit für ${dimension.label}.`
    if (answer.status === 'inferred_from_feedback' && (!Number.isFinite(answer.score) || answer.score! < 0 || answer.score! > 3 || Math.abs(answer.score! * 10 - Math.round(answer.score! * 10)) > 1e-8)) return `Wählen Sie für ${dimension.label} einen Punktwert von 0,0 bis 3,0 in Schritten von 0,1.`
    if (answer.status === 'not_inferable' && answer.feedback_evidence.length) return `Entfernen Sie die Punktwertbelege für die nicht ableitbare Dimension ${dimension.label}.`
    return null
  }
  const criterion = packet.criteria?.[index]
  if (!criterion) return null
  const answer = draft.criterionRatings[criterion.criterion_id]
  if (!answer || (!answer.unable_to_judge && answer.score === null)) return `Bewerten Sie ${criterion.label} oder wählen Sie „Nicht beurteilbar“.`
  if (answer.unable_to_judge && !answer.comment.trim()) return `Begründen Sie, warum ${criterion.label} nicht beurteilbar ist.`
  if (!answer.unable_to_judge && (!Number.isInteger(answer.score) || answer.score! < (packet.scale?.min ?? 1) || answer.score! > (packet.scale?.max ?? 5))) return `Wählen Sie für ${criterion.label} einen Punktwert innerhalb der Skala dieses Pakets.`
  return null
}