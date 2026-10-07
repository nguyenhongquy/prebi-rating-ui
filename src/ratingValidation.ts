import type { Draft, Packet } from './ratingTypes'

export type PacketState = 'not_started' | 'draft' | 'changed' | 'submitted'
export type CaseState = 'not_started' | 'in_progress' | 'complete'

export function emptyDraft(packet: Packet): Draft {
  return {
    criterionRatings: Object.fromEntries((packet.criteria ?? []).map(item => [item.criterion_id, { score: null, unable_to_judge: false, comment: '' }])),
    scoreAnswers: Object.fromEntries((packet.score_dimensions ?? []).map(item => [item.dimension_id, { status: 'unanswered', score: null, confidence: 'not_inferable', rationale: '', feedback_evidence: [] }])),
    overallComment: '',
    spanComments: [],
  }
}

export function caseState(packet: Packet, draft: Draft | undefined): CaseState {
  if (!draft) return 'not_started'
  const started = Boolean(draft.overallComment.trim() || draft.spanComments.length
    || Object.values(draft.criterionRatings).some(answer => answer.score !== null || answer.unable_to_judge || answer.comment.trim())
    || Object.values(draft.scoreAnswers).some(answer => answer.status !== 'unanswered' || answer.rationale.trim() || answer.feedback_evidence.length))
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
  return packet.task === 'feedback_implied_score'
    ? (packet.score_dimensions ?? []).map(dimension => ({ id: dimension.dimension_id, label: dimension.label }))
    : (packet.criteria ?? []).map(criterion => ({ id: criterion.criterion_id, label: criterion.label }))
}

export function answerError(packet: Packet, draft: Draft, index: number): string | null {
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