import type { Segment } from './ratingTypes'

export type CandidateLabel = 'A' | 'B' | 'C'
export type PairKey = 'A-B' | 'A-C' | 'B-C'
export type ReleaseChoice = 'ready' | 'edit' | 'reject'
export type PairPreference = 'first' | 'second' | 'tie'
export type FeedbackComponent = 'strengths' | 'weaknesses' | 'suggestions'

export type GeneratedFeedback = Partial<Record<FeedbackComponent, Array<{ text: string; evidence_segment_ids: string[] }>>>
export type FeedbackCandidate = {
  candidate_id: string
  feedback: GeneratedFeedback
}

export type HumanSegmentAnnotation = {
  segment_id: string
  dimension_id: string
  skill_label: string
  level: string
}

export type DescriptiveSegmentDimension = {
  dimension_id: string
  known_band_count: number
  positive_band_count: number
  band_counts: Record<'0' | '1' | '2' | '3', number>
  band_percentages: Record<'1' | '2' | '3', number>
  distinct_assigned_segment_count: number
}

export type DescriptiveSegmentSummary = {
  aggregation_unit: 'candidate_annotation'
  counting_note?: string
  dimensions: DescriptiveSegmentDimension[]
}

export type FeedbackEvaluationCase = {
  case_id: string
  reflection_id: string
  reflection: { segments: Segment[] }
  candidates: [FeedbackCandidate, FeedbackCandidate, FeedbackCandidate]
  display_order: Record<CandidateLabel, string>
  human_annotations: HumanSegmentAnnotation[]
  segment_summary: DescriptiveSegmentSummary
}

export type ReferenceScoringDimension = {
  dimension_id: string
  name: string
  description: string
  bands: Record<'0' | '1' | '2' | '3', string>
}

export type ReferenceScoring = {
  protocol_id: 'reflection_reference_score_human'
  protocol_version: string
  human_protocol: string
  rubric_version: string
  scale: { min: 0; max: 3; step: 0.5 }
  dimensions: ReferenceScoringDimension[]
}

export type PairwiseInputBundle = {
  schema_version: '1.2.0'
  protocol_id: 'prebi_blinded_feedback_preference'
  protocol_version: '1.2.0'
  reference_scoring: ReferenceScoring
  cases: FeedbackEvaluationCase[]
}

export type CaseResponse = {
  reference_scores: Partial<Record<string, number>>
  reference_comments: Partial<Record<string, string>>
  reference_confirmed_at?: string
  release_readiness: Partial<Record<string, ReleaseChoice>>
  explanations: Partial<Record<string, string>>
  pairwise_preferences: Partial<Record<PairKey, PairPreference>>
  completed_at?: string
}

export type PairwiseEvaluationSession = {
  kind: 'prebi_pairwise_evaluation_session'
  schema_version: '1.2.0'
  protocol_id: PairwiseInputBundle['protocol_id']
  protocol_version: PairwiseInputBundle['protocol_version']
  evaluator_id: string
  input_bundle_sha256: string
  input_bundle: PairwiseInputBundle
  responses: Record<string, CaseResponse>
  active_case_index: number
  started_at: string
  updated_at: string
  completed_at: string | null
}
