export type RatingTask = 'reflection_reference_score' | 'assessment_quality' | 'feedback_quality' | 'feedback_implied_score'
export type ConsensusStatus = 'in_progress' | 'flagged' | 'finalized'
export type ConsensusCaseState = 'not_started' | ConsensusStatus
export type ConsensusHistoryEntry = { finalized_at: string; finalized_by: string }
export type ConsensusRecord = {
  status: ConsensusStatus
  note: string
  finalized_at: string | null
  finalized_by: string | null
  finalization_history: ConsensusHistoryEntry[]
}
export type AssessmentReferenceSnapshot = {
  packet_id: string
  finalized_at: string
  scores: Record<string, number>
}
export type AssessmentReferenceRecord = {
  used_snapshot: AssessmentReferenceSnapshot | null
  reviewed_snapshot: AssessmentReferenceSnapshot | null
  reviewed_at: string | null
}
export type C1Snapshot = {
  snapshot_id: string
  packet_id: string
  protocol_id: string
  protocol_version: string
  packet_version: string
  panel_id: string
  finalized_at: string
  consensus_note: string
  finalization_history: ConsensusHistoryEntry[]
  criterion_ratings: Record<string, CriterionAnswer>
  overall_comment: string
  span_comments: SpanComment[]
}
export type FeedbackComparisonHistoryEntry = {
  c1_snapshot_id: string
  historical_feedback_revealed_at: string | null
  decision: 'keep' | 'revised'
  revised_criterion_ratings: Record<string, number | null>
  revision_reasons: Record<string, string>
  finalized_at: string
  reopened_at: string
}
export type FeedbackComparisonCase = {
  status: 'in_progress' | 'finalized'
  c1_snapshot_id: string
  historical_feedback_revealed_at: string | null
  decision: 'keep' | 'revised' | null
  revised_criterion_ratings: Record<string, number | null>
  revision_reasons: Record<string, string>
  finalized_at: string | null
  history: FeedbackComparisonHistoryEntry[]
}
export type FeedbackComparisonState = {
  stage: 'c1' | 'c2'
  historical_feedback_revealed_at: string | null
  cases: Record<string, FeedbackComparisonCase>
}
export type Criterion = { criterion_id: string; label: string; description: string; anchors?: Record<string, string> }
export type Segment = { segment_id: string; order: number; text: string }
export type SegmentAnnotation = {
  segment_id: string
  dimension_id: string
  skill_label?: string
  level?: string
  candidate_id?: string
  scope?: 'in_scope' | 'out_of_scope' | 'unknown'
  scope_known?: boolean
  known?: boolean
  requires_review?: boolean
}
export type SegmentAnnotationSummaryDimension = {
  dimension_id: string
  known_band_count: number
  positive_band_count: number
  band_counts: Record<'0' | '1' | '2' | '3', number>
  band_percentages: Record<'1' | '2' | '3', number>
  mean_positive_band?: number | null
  distinct_assigned_segment_count?: number
}
export type SegmentAnnotationSummary = {
  aggregation_unit: 'candidate_annotation'
  counting_note?: string
  dimensions: SegmentAnnotationSummaryDimension[]
}
export type FeedbackItem = { text: string; evidence_segment_ids?: string[] }
export type SynthesisClaim = { interpretation: string; evidence_refs: string[] }
export type DimensionSynthesis = {
  dimension_id: 'SW' | 'UA' | 'HA'
  demonstrated_depth: SynthesisClaim[]
  development: SynthesisClaim[]
  integrative_coherence: SynthesisClaim[]
  limitations: SynthesisClaim[]
  uncertainty: SynthesisClaim[]
}
export type EvidenceSpan = { start_character: number; end_character: number; quote: string }
export type CriterionAnswer = { score: number | null; unable_to_judge: boolean; comment: string }
export type ReferenceScoreAnswer = { score: number | null; rationale: string; evidence_segment_ids: string[] }
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
  referenceAnswers: Record<string, ReferenceScoreAnswer>
  overallComment: string
  spanComments: SpanComment[]
}
export type Packet = {
  packet_id: string
  reflection_id?: string
  task: RatingTask
  packet_version: string
  protocol_id: string
  protocol_version: string
  human_protocol: string
  criteria?: Criterion[]
  scale?: { min: number; max: number; step?: number; id?: string; anchors: Record<string, string> }
  score_dimensions?: Array<{ dimension_id: string; label: string }>
  segment_annotations?: SegmentAnnotation[]
  segment_annotation_summary?: SegmentAnnotationSummary
  pipeline_version?: string
  evidence_synthesis?: DimensionSynthesis[]
  synthesis_display_allowed?: boolean
  display_synthesis_sha256?: string
  reflection: { segments: Segment[] }
  rubric: {
    version: string
    level?: 'document'
    rubric_id?: string
    glossary?: Record<string, string>
    scale?: Record<string, unknown>
    assessment_principles?: Record<string, unknown>
    dimensions: Array<{ dimension_id: string; name: string; description: string; bands: Record<string, string> }>
  }
  output?: {
    dimensions?: Array<{ dimension_id: string; score: number; justification: string; evidence_segment_ids: string[]; intermediate_score_explanation?: string | null }>
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