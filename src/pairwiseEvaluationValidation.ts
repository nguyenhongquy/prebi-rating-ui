import type { CandidateLabel, DescriptiveSegmentSummary, FeedbackEvaluationCase, FeedbackCandidate, GeneratedFeedback, PairKey, PairPreference, PairwiseInputBundle, ReferenceScoring, ReleaseChoice } from './pairwiseEvaluationTypes'

const componentNames = ['strengths', 'weaknesses', 'suggestions'] as const
const labels: CandidateLabel[] = ['A', 'B', 'C']
const pairKeys: PairKey[] = ['A-B', 'A-C', 'B-C']
const releaseChoices: ReleaseChoice[] = ['ready', 'edit', 'reject']
const preferences: PairPreference[] = ['first', 'second', 'tie']
const protectedField = /(judge|model|generation|llm|historical.?feedback|human.?feedback|lecturer.?feedback|experimental.?condition|^condition(?:_|$)|reference.?concern|fidelity)/i

const bandLetters: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C' }

/** Maps a human level such as "Band 2" to "Band B"; Band 0 and unrecognised levels yield null. */
export function humanAnnotationBand(level: string): string | null {
  const match = /^\s*Band\s+([0-3])\b(.*)$/.exec(level)
  const letter = match && bandLetters[match[1]]
  return letter ? `Band ${letter}${match[2].trimEnd()}` : null
}

function object(value: unknown, error = 'Ungültige Eingabedatei.'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function exactKeys(value: unknown, required: string[], error: string, optional: string[] = []) {
  const record = object(value, error)
  const allowed = [...required, ...optional]
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !allowed.includes(key))) throw new Error(error)
  return record
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error(`${field} muss ein gültiger pseudonymer Bezeichner sein.`)
  }
  return value
}

function candidateIdentifier(value: unknown): string {
  const candidateId = identifier(value, 'Kandidaten-ID')
  if (/(^|[-_.])(g[1-3]|condition|model|judge|llm|gpt|gemini|claude|generation)([-_.]|$)/i.test(candidateId)) {
    throw new Error('Kandidaten-IDs dürfen keine experimentellen Bedingungen oder Modell-/Judge-Bezeichnungen offenlegen.')
  }
  return candidateId
}

function inspectBlinding(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inspectBlinding)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (protectedField.test(key)) throw new Error('Das Evaluationspaket enthält geschützte Modell-, Judge-, Bedingungs- oder Referenzinformationen.')
    inspectBlinding(child)
  }
}

function validateFeedback(value: unknown, segmentIds: Set<string>): GeneratedFeedback {
  const feedback = exactKeys(value, [], 'Ungültige Feedbackstruktur.', [...componentNames])
  let hasContent = false
  for (const key of componentNames) {
    if (feedback[key] === undefined) continue
    if (!Array.isArray(feedback[key])) throw new Error('Ein Feedbackabschnitt muss eine Liste mit Textinhalten sein.')
    feedback[key] = feedback[key].map(item => {
      const entry = exactKeys(item, ['text', 'evidence_segment_ids'], 'Ungültiger Feedbackeintrag.')
      if (typeof entry.text !== 'string' || !entry.text.trim()) throw new Error('Feedbackinhalte dürfen nicht leer sein.')
      if (!Array.isArray(entry.evidence_segment_ids) || !entry.evidence_segment_ids.every(id => typeof id === 'string' && segmentIds.has(id))) throw new Error('Ein Feedbackbeleg verweist auf ein unbekanntes Reflexionssegment.')
      hasContent = true
      return { text: entry.text, evidence_segment_ids: entry.evidence_segment_ids as string[] }
    })
  }
  if (!hasContent) throw new Error('Jedes Feedback muss mindestens einen nicht-leeren Inhalt enthalten.')
  return feedback as GeneratedFeedback
}

function validateCase(value: unknown): FeedbackEvaluationCase {
  const item = exactKeys(value, ['case_id', 'reflection_id', 'reflection', 'candidates', 'display_order', 'human_annotations', 'segment_summary'], 'Ungültiger Evaluationsfall.')
  const caseId = identifier(item.case_id, 'Fall-ID')
  const reflectionId = identifier(item.reflection_id, 'Reflexions-ID')
  const reflection = exactKeys(item.reflection, ['segments'], 'Ungültiger Reflexionsinhalt.')
  if (!Array.isArray(reflection.segments) || reflection.segments.length === 0) throw new Error(`Fall ${caseId} enthält keine Reflexionssegmente.`)
  const segmentIds = new Set<string>()
  const orders = new Set<number>()
  const segments = reflection.segments.map(value => {
    const segment = exactKeys(value, ['segment_id', 'order', 'text'], 'Ungültiges Reflexionssegment.')
    const segmentId = identifier(segment.segment_id, 'Segment-ID')
    if (segmentIds.has(segmentId)) throw new Error(`Fall ${caseId} enthält doppelte Segment-IDs.`)
    segmentIds.add(segmentId)
    if (typeof segment.text !== 'string' || !segment.text.trim()) throw new Error(`Fall ${caseId} enthält ein leeres Reflexionssegment.`)
    if (!Number.isSafeInteger(segment.order) || Number(segment.order) < 0 || orders.has(Number(segment.order))) throw new Error(`Fall ${caseId} enthält ungültige Segmentpositionen.`)
    orders.add(Number(segment.order))
    return { segment_id: segmentId, order: Number(segment.order), text: segment.text }
  })
  if (!Array.isArray(item.candidates) || item.candidates.length !== 3) throw new Error(`Fall ${caseId} muss genau drei Feedbackkandidaten enthalten.`)
  const candidateIds = new Set<string>()
  const candidates = item.candidates.map(value => {
    const candidate = exactKeys(value, ['candidate_id', 'feedback'], 'Ungültiger Feedbackkandidat.')
    const candidateId = candidateIdentifier(candidate.candidate_id)
    if (candidateIds.has(candidateId)) throw new Error(`Fall ${caseId} enthält doppelte Kandidaten.`)
    candidateIds.add(candidateId)
    return { candidate_id: candidateId, feedback: validateFeedback(candidate.feedback, segmentIds) }
  })
  if (!Array.isArray(item.human_annotations)) throw new Error(`Fall ${caseId} benötigt menschliche Segmentannotationen.`)
  const annotations = item.human_annotations.map(value => {
    const annotation = exactKeys(value, ['segment_id', 'dimension_id', 'skill_label', 'level'], 'Ungültige menschliche Segmentannotation.')
    const segmentId = identifier(annotation.segment_id, 'Segment-ID der Annotation')
    if (!segmentIds.has(segmentId)) throw new Error(`Fall ${caseId} enthält eine Annotation für ein unbekanntes Segment.`)
    if (typeof annotation.dimension_id !== 'string' || !annotation.dimension_id.trim()) throw new Error('Der Dimensionsbezeichner einer menschlichen Annotation fehlt.')
    if (typeof annotation.skill_label !== 'string' || !annotation.skill_label.trim() || typeof annotation.level !== 'string' || !annotation.level.trim()) {
      throw new Error('Menschliche Annotationen benötigen Skill-Label und Level.')
    }
    return { segment_id: segmentId, dimension_id: annotation.dimension_id, skill_label: annotation.skill_label, level: annotation.level }
  })
  const summary = validateSegmentSummary(item.segment_summary, caseId, segments.length)
  const summaryDimensions = new Set(summary.dimensions.map(dimension => dimension.dimension_id))
  if (annotations.some(annotation => !summaryDimensions.has(annotation.dimension_id))) throw new Error(`Fall ${caseId} enthält eine Annotation ohne passende deskriptive Dimension.`)
  const displayOrder = exactKeys(item.display_order, labels, 'Die A/B/C-Anzeigereihenfolge ist ungültig.')
  const orderedIds = labels.map(label => identifier(displayOrder[label], 'Kandidaten-ID in der Anzeigereihenfolge'))
  if (new Set(orderedIds).size !== 3 || orderedIds.some(id => !candidateIds.has(id))) throw new Error(`Fall ${caseId} muss alle drei Kandidaten genau einmal in der Anzeigereihenfolge enthalten.`)
  return {
    case_id: caseId,
    reflection_id: reflectionId,
    reflection: { segments },
    candidates: candidates as [FeedbackCandidate, FeedbackCandidate, FeedbackCandidate],
    display_order: { A: orderedIds[0], B: orderedIds[1], C: orderedIds[2] },
    human_annotations: annotations,
    segment_summary: summary,
  }
}

function validateSegmentSummary(value: unknown, caseId: string, segmentCount: number): DescriptiveSegmentSummary {
  const summary = exactKeys(value, ['aggregation_unit', 'dimensions'], 'Ungültige deskriptive Segmentzusammenfassung.', ['counting_note'])
  if (summary.aggregation_unit !== 'candidate_annotation' || !Array.isArray(summary.dimensions) || summary.dimensions.length === 0) {
    throw new Error(`Fall ${caseId} benötigt deskriptive Segmentstatistiken.`)
  }
  if (summary.counting_note !== undefined && typeof summary.counting_note !== 'string') throw new Error('Ungültiger Hinweis zur Zählweise.')
  const seenDimensions = new Set<string>()
  const dimensions = summary.dimensions.map(value => {
    const dimension = exactKeys(value, ['dimension_id', 'known_band_count', 'positive_band_count', 'band_counts', 'band_percentages', 'distinct_assigned_segment_count'], 'Ungültige deskriptive Segmentdimension.')
    if (typeof dimension.dimension_id !== 'string' || !dimension.dimension_id.trim() || seenDimensions.has(dimension.dimension_id)) throw new Error('Deskriptive Dimensionsbezeichner müssen eindeutig und nicht leer sein.')
    seenDimensions.add(dimension.dimension_id)
    const counts = exactKeys(dimension.band_counts, ['0', '1', '2', '3'], 'Ungültige Segmentbandhäufigkeiten.')
    const percentages = exactKeys(dimension.band_percentages, ['1', '2', '3'], 'Ungültige Segmentbandprozente.')
    for (const count of Object.values(counts)) if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error('Segmentbandhäufigkeiten müssen nichtnegative Ganzzahlen sein.')
    const knownCount = Number(counts['0']) + Number(counts['1']) + Number(counts['2']) + Number(counts['3'])
    const positiveCount = Number(counts['1']) + Number(counts['2']) + Number(counts['3'])
    if (dimension.known_band_count !== knownCount || dimension.positive_band_count !== positiveCount) throw new Error('Segmentbandhäufigkeiten stimmen nicht mit den deskriptiven Zählern überein.')
    for (const band of ['1', '2', '3'] as const) {
      const percentage = percentages[band]
      const expected = positiveCount ? Number(counts[band]) * 100 / positiveCount : 0
      if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100 || Math.abs(percentage - expected) > 0.11) {
        throw new Error('Segmentbandprozente stimmen nicht mit den Häufigkeiten überein.')
      }
    }
    if (!Number.isSafeInteger(dimension.distinct_assigned_segment_count) || Number(dimension.distinct_assigned_segment_count) < 0 || Number(dimension.distinct_assigned_segment_count) > segmentCount) {
      throw new Error('Ungültige Anzahl verschiedener annotierter Segmente.')
    }
    return {
      dimension_id: dimension.dimension_id,
      known_band_count: Number(dimension.known_band_count),
      positive_band_count: Number(dimension.positive_band_count),
      band_counts: counts as DescriptiveSegmentSummary['dimensions'][number]['band_counts'],
      band_percentages: percentages as DescriptiveSegmentSummary['dimensions'][number]['band_percentages'],
      distinct_assigned_segment_count: Number(dimension.distinct_assigned_segment_count),
    }
  })
  return {
    aggregation_unit: 'candidate_annotation',
    ...(typeof summary.counting_note === 'string' ? { counting_note: summary.counting_note } : {}),
    dimensions,
  }
}

export function isValidReferenceScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3 && Number.isInteger(value * 2)
}

function validateReferenceScoring(value: unknown): ReferenceScoring {
  const reference = exactKeys(value, ['protocol_id', 'protocol_version', 'human_protocol', 'rubric_version', 'scale', 'dimensions'], 'Ungültige Angaben zur Referenzbewertung.')
  if (reference.protocol_id !== 'reflection_reference_score_human' || typeof reference.protocol_version !== 'string' || !reference.protocol_version.trim()
    || typeof reference.human_protocol !== 'string' || !reference.human_protocol.trim() || typeof reference.rubric_version !== 'string' || !reference.rubric_version.trim()) {
    throw new Error('Das Protokoll der Referenzbewertung fehlt oder wird nicht unterstützt.')
  }
  const scale = exactKeys(reference.scale, ['min', 'max', 'step'], 'Ungültige Skala der Referenzbewertung.')
  if (scale.min !== 0 || scale.max !== 3 || scale.step !== 0.5) throw new Error('Die Referenzbewertung muss die Skala 0 bis 3 in Schritten von 0,5 verwenden.')
  if (!Array.isArray(reference.dimensions) || !reference.dimensions.length) throw new Error('Die Referenzbewertung benötigt Rubrikdimensionen.')
  const seen = new Set<string>()
  const dimensions = reference.dimensions.map(item => {
    const dimension = exactKeys(item, ['dimension_id', 'name', 'description', 'bands'], 'Ungültige Dimension der Referenzbewertung.')
    const dimensionId = identifier(dimension.dimension_id, 'Dimensions-ID der Referenzbewertung')
    if (seen.has(dimensionId)) throw new Error('Dimensionen der Referenzbewertung müssen eindeutig sein.')
    seen.add(dimensionId)
    const bands = exactKeys(dimension.bands, ['0', '1', '2', '3'], 'Die Referenzbewertung benötigt Rubrikanker 0 bis 3.')
    if (typeof dimension.name !== 'string' || !dimension.name.trim() || typeof dimension.description !== 'string' || Object.values(bands).some(text => typeof text !== 'string' || !text.trim())) {
      throw new Error('Rubrikdimensionen benötigen Namen, Beschreibung und Ankertexte.')
    }
    return { dimension_id: dimensionId, name: dimension.name, description: dimension.description, bands: bands as ReferenceScoring['dimensions'][number]['bands'] }
  })
  return { protocol_id: 'reflection_reference_score_human', protocol_version: reference.protocol_version, human_protocol: reference.human_protocol, rubric_version: reference.rubric_version, scale: { min: 0, max: 3, step: 0.5 }, dimensions }
}

export function validateEvaluationBundle(value: unknown): PairwiseInputBundle {
  inspectBlinding(value)
  const bundle = exactKeys(value, ['schema_version', 'protocol_id', 'protocol_version', 'reference_scoring', 'cases'], 'Ungültiges oder nicht unterstütztes Evaluationspaket.')
  if (bundle.schema_version !== '1.2.0' || bundle.protocol_id !== 'prebi_blinded_feedback_preference' || bundle.protocol_version !== '1.2.0') {
    throw new Error('Die Version des Evaluationspakets wird nicht unterstützt.')
  }
  const referenceScoring = validateReferenceScoring(bundle.reference_scoring)
  if (!Array.isArray(bundle.cases) || !bundle.cases.length) throw new Error('Das Evaluationspaket muss mindestens einen Fall enthalten.')
  const cases = bundle.cases.map(validateCase)
  if (new Set(cases.map(item => item.case_id)).size !== cases.length) throw new Error('Fall-IDs müssen eindeutig sein.')
  return { schema_version: '1.2.0', protocol_id: 'prebi_blinded_feedback_preference', protocol_version: '1.2.0', reference_scoring: referenceScoring, cases }
}

export function canonicalEvaluationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvaluationJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalEvaluationJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function referenceScoresComplete(response: { reference_scores: Record<string, unknown> }, dimensionIds: string[]): boolean {
  return dimensionIds.length > 0 && dimensionIds.every(id => isValidReferenceScore(response.reference_scores[id]))
}

export function caseCompletion(
  response: { reference_scores: Record<string, unknown>; reference_confirmed_at?: string; release_readiness: Record<string, unknown>; pairwise_preferences: Record<string, unknown> },
  candidateIds: string[],
  dimensionIds: string[],
): { complete: boolean; referenceConfirmed: boolean; decisions: number; total: number } {
  const scoreCount = dimensionIds.filter(id => isValidReferenceScore(response.reference_scores[id])).length
  const referenceConfirmed = Boolean(response.reference_confirmed_at) && scoreCount === dimensionIds.length && dimensionIds.length > 0
  const releaseCount = candidateIds.filter(id => releaseChoices.includes(response.release_readiness[id] as ReleaseChoice)).length
  const pairCount = pairKeys.filter(key => preferences.includes(response.pairwise_preferences[key] as PairPreference)).length
  return {
    complete: referenceConfirmed && releaseCount === 3 && pairCount === 3,
    referenceConfirmed,
    decisions: scoreCount + releaseCount + pairCount,
    total: dimensionIds.length + 6,
  }
}

export function pairCandidates(displayOrder: Record<CandidateLabel, string>, key: PairKey): [string, string] {
  const [first, second] = key.split('-') as [CandidateLabel, CandidateLabel]
  return [displayOrder[first], displayOrder[second]]
}
