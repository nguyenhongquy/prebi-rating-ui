export type RatingTask = 'assessment_quality' | 'feedback_quality' | 'feedback_implied_score'
export type Criterion = { criterion_id: string; label: string; description: string; anchors?: Record<string, string> }
export type Segment = { segment_id: string; order: number; text: string }
export type FeedbackItem = { text: string; evidence_segment_ids?: string[] }
export type EvidenceSpan = { start_character: number; end_character: number; quote: string }
export type CriterionAnswer = { score: number | null; unable_to_judge: boolean; comment: string }
export type SpanComment = {
  feedback_component: string
  feedback_item_index: number
  start_character: number
  end_character: number
  comment: string
  tags: string[]
  linked_reflection_segment_ids: string[]
}
export type ScoreAnswer = {
  status: 'unanswered' | 'inferred_from_feedback' | 'not_inferable'
  score: number | null
  confidence: 'low' | 'medium' | 'high' | 'not_inferable'
  rationale: string
  feedback_evidence: EvidenceSpan[]
}
export type Draft = {
  criterionRatings: Record<string, CriterionAnswer>
  scoreAnswers: Record<string, ScoreAnswer>
  overallComment: string
  spanComments: SpanComment[]
}
export type Packet = {
  packet_id: string
  task: RatingTask
  packet_version: string
  protocol_id: string
  protocol_version: string
  human_protocol: string
  criteria?: Criterion[]
  scale?: { min: number; max: number; anchors: Record<string, string> }
  score_dimensions?: Array<{ dimension_id: string; label: string }>
  reflection: { segments: Segment[] }
  rubric: { version: string; dimensions: Array<{ dimension_id: string; name: string; description: string; bands: Record<string, string> }> }
  output?: {
    dimensions?: Array<{ dimension_id: string; score: number; justification: string; evidence_segment_ids: string[] }>
    strengths?: FeedbackItem[]
    weaknesses?: FeedbackItem[]
    suggestions?: FeedbackItem[]
  }
  human_feedback?: string
  display_output_sha256?: string
  displayed_reflection_sha256?: string
  condition_blinded: true
}

export const componentLabels: Record<string, string> = { strengths: 'Stärken', weaknesses: 'Entwicklungsbedarf', suggestions: 'Handlungsvorschläge' }