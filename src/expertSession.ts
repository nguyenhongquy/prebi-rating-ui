import type { AssessmentReferenceRecord, AssessmentReferenceSnapshot, ConsensusCaseState, ConsensusHistoryEntry, ConsensusRecord, Draft, Packet, RatingTask } from './ratingTypes'
import { answerError, canonicalJson, caseState, emptyDraft, evaluationSteps, isValidReferenceScore, REFERENCE_SCORE_SCALE, responseForDraft } from './ratingValidation'

export type PendingEditor = {
  selection: { component: string; index: number; start: number; end: number; quote: string } | null
  comment: string
  tags: string[]
}

export type ExpertSession = {
  kind: 'prebi_expert_session'
  schema_version: '1.0.0' | '1.1.0' | '1.2.0'
  evaluator_id: string
  bundle_sha256: string
  packets: Packet[]
  drafts: Record<string, Draft>
  pending_editors?: Record<string, PendingEditor>
  active_task: RatingTask
  active_index: number
  active_criterion: number
  evaluation_mode?: 'expert_consensus'
  panel_id?: string
  panel_members?: string[]
  consensus?: Record<string, ConsensusRecord>
  assessment_reference_snapshots?: Record<string, AssessmentReferenceRecord>
}

const tasks = ['reflection_reference_score', 'assessment_quality', 'feedback_quality', 'feedback_implied_score']
const tags = ['unsupported', 'inaccurate', 'vague', 'actionable', 'strength', 'concern', 'other']
const consensusTasks = ['reflection_reference_score', 'assessment_quality', 'feedback_quality']

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiges Sitzungsobjekt.')
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: string[]) {
  const record = object(value)
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new Error('Unbekannte oder fehlende Felder in der Sitzung.')
  return record
}

function allowKeys(value: unknown, required: string[], optional: string[] = []) {
  const record = object(value)
  const allowed = [...required, ...optional]
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !allowed.includes(key))) throw new Error('Ungültige Felder im Referenzpaket.')
  return record
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Textfeld der Sitzung ist ungültig.')
}

function identifiers(values: unknown[], field: string) {
  const ids = values.map(value => {
    const id = object(value)[field]
    text(id)
    if (!id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Ungültige ID.')
    return id
  })
  if (new Set(ids).size !== ids.length) throw new Error('IDs müssen eindeutig sein.')
  return ids
}

function panelIdentifier(value: unknown) {
  text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error('Panel-ID muss ein pseudonymer Bezeichner ohne Leerzeichen sein.')
  return value
}

export function assertConsensusBlinding(packets: Packet[]) {
  const protectedField = /(judge|model|experimental.?condition|^condition(?:_|$))/i
  function inspect(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'condition_blinded' && protectedField.test(key)) throw new Error('Konsenspakete dürfen keine LLM-Judge-, Modell- oder Bedingungsinformationen enthalten.')
      inspect(child)
    }
  }
  packets.forEach(inspect)
}

export function emptyConsensus(packets: Packet[]): Record<string, ConsensusRecord> {
  return Object.fromEntries(packets.filter(packet => consensusTasks.includes(packet.task)).map(packet => [packet.packet_id, {
    status: 'in_progress', note: '', finalized_at: null, finalized_by: null, finalization_history: [],
  }]))
}

export function consensusAnswerErrors(packet: Packet, draft: Draft) {
  return evaluationSteps(packet).map((_, index) => answerError(packet, draft, index)).filter((error): error is string => error !== null)
}

export function consensusCaseState(packet: Packet, session: Pick<ExpertSession, 'drafts' | 'pending_editors' | 'consensus'>): ConsensusCaseState {
  const record = session.consensus?.[packet.packet_id]
  if (record?.status === 'finalized' || record?.status === 'flagged') return record.status
  if (record?.note.trim()) return 'in_progress'
  return expertCaseState(packet, session) === 'not_started' ? 'not_started' : 'in_progress'
}

export function filteredConsensusIndexes(statuses: ConsensusCaseState[], filter: 'all' | 'open' | 'flagged' | 'finalized', activeIndex: number) {
  return statuses.map((_, index) => index).filter(index => {
    const status = statuses[index]
    if (filter === 'all' || index === activeIndex) return true
    if (filter === 'open') return status !== 'finalized'
    if (filter === 'flagged') return status === 'flagged'
    return status === 'finalized'
  })
}

export function finalizeConsensus(record: ConsensusRecord, packet: Packet, draft: Draft, panelId: string, finalizedAt = new Date().toISOString()): ConsensusRecord {
  const errors = consensusAnswerErrors(packet, draft)
  if (errors.length) throw new Error(errors.join(' '))
  panelIdentifier(panelId)
  if (!Number.isFinite(Date.parse(finalizedAt))) throw new Error('Ungültiger Finalisierungszeitpunkt.')
  return { ...record, status: 'finalized', finalized_at: finalizedAt, finalized_by: panelId }
}

export function flagConsensus(record: ConsensusRecord): ConsensusRecord {
  if (record.status === 'finalized') throw new Error('Ein finalisierter Konsens muss zuerst zur Bearbeitung geöffnet werden.')
  return { ...record, status: 'flagged', finalized_at: null, finalized_by: null }
}

export function resumeConsensus(record: ConsensusRecord): ConsensusRecord {
  if (record.status !== 'flagged') return record
  return { ...record, status: 'in_progress', finalized_at: null, finalized_by: null }
}

export function reopenConsensus(record: ConsensusRecord): ConsensusRecord {
  if (record.status !== 'finalized' || !record.finalized_at || !record.finalized_by) throw new Error('Nur ein erreichter Konsens kann zur Bearbeitung geöffnet werden.')
  const history: ConsensusHistoryEntry[] = [...record.finalization_history, { finalized_at: record.finalized_at, finalized_by: record.finalized_by }]
  return { ...record, status: 'in_progress', finalized_at: null, finalized_by: null, finalization_history: history }
}

export function researchExportPackets(session: ExpertSession): Packet[] {
  if (session.evaluation_mode !== 'expert_consensus') return session.packets.filter(packet => expertCaseState(packet, session) === 'complete')
  return session.packets.filter(packet => consensusTasks.includes(packet.task) && session.consensus?.[packet.packet_id]?.status === 'finalized'
    && consensusAnswerErrors(packet, session.drafts[packet.packet_id]).length === 0)
}

export function consensusResearchExport(session: ExpertSession, createRatingId: () => string = () => crypto.randomUUID()) {
  if (session.evaluation_mode !== 'expert_consensus' || !session.panel_id) throw new Error('Konsensmetadaten fehlen.')
  const ratings = researchExportPackets(session).map(packet => {
    const consensus = session.consensus?.[packet.packet_id]
    if (!consensus?.finalized_at || consensus.status !== 'finalized') throw new Error('Nicht finalisierte Fälle dürfen nicht exportiert werden.')
    return {
      schema_version: '1.1.0',
      rating_id: createRatingId(),
      packet_id: packet.packet_id,
      task: packet.task,
      evaluator_type: 'human',
      evaluator_id: session.panel_id,
      protocol_id: packet.protocol_id,
      protocol_version: packet.protocol_version,
      ...(packet.task === 'reflection_reference_score' ? { scoring_scale_id: REFERENCE_SCORE_SCALE.id } : {}),
      packet_version: packet.packet_version,
      display_output_sha256: packet.display_output_sha256,
      displayed_reflection_sha256: packet.displayed_reflection_sha256,
      submitted_at: consensus.finalized_at,
      response: responseForDraft(packet, session.drafts[packet.packet_id]),
      consensus,
      ...(packet.task === 'assessment_quality' && session.assessment_reference_snapshots?.[packet.packet_id]
        ? { assessment_reference: session.assessment_reference_snapshots[packet.packet_id] }
        : {}),
    }
  })
  return {
    schema_version: '1.1.0',
    evaluation_mode: 'expert_consensus',
    panel_id: session.panel_id,
    ...(session.panel_members ? { panel_members: session.panel_members } : {}),
    ratings,
  }
}

export function validatePackets(value: unknown): Packet[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Die Datei muss verblindete Bewertungspakete enthalten.')
  identifiers(value, 'packet_id')
  for (const item of value) {
    const packet = object(item)
    if (packet.condition_blinded !== true || typeof packet.task !== 'string' || !tasks.includes(packet.task)) throw new Error('Die Datei muss verblindete Bewertungspakete enthalten.')
    if (packet.task === 'reflection_reference_score') {
      allowKeys(packet, ['packet_id', 'task', 'packet_version', 'protocol_id', 'protocol_version', 'human_protocol', 'condition_blinded', 'reflection', 'rubric', 'score_dimensions'], ['scale', 'segment_annotations', 'displayed_reflection_sha256', 'reflection_id'])
      if (packet.scale !== undefined) {
        const scale = allowKeys(packet.scale, ['min', 'max', 'anchors'], ['step', 'id'])
        if (scale.min !== REFERENCE_SCORE_SCALE.min || scale.max !== REFERENCE_SCORE_SCALE.max
          || (scale.step !== undefined && scale.step !== REFERENCE_SCORE_SCALE.step)
          || (scale.id !== undefined && scale.id !== REFERENCE_SCORE_SCALE.id)) throw new Error('Das Referenzbewertungsprotokoll verwendet eine inkompatible Punktwertskala.')
        Object.values(object(scale.anchors)).forEach(text)
      }
    }
    if (packet.reflection_id !== undefined) {
      text(packet.reflection_id)
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(packet.reflection_id)) throw new Error('Ungültige pseudonyme Reflexions-ID.')
    }
    for (const field of ['packet_version', 'protocol_id', 'protocol_version', 'human_protocol']) text(packet[field])
    const reflection = object(packet.reflection)
    if (packet.task === 'reflection_reference_score') allowKeys(reflection, ['segments'])
    if (!Array.isArray(reflection.segments)) throw new Error('Ungültige Reflexion.')
    identifiers(reflection.segments, 'segment_id')
    const segmentOrders = new Set<number>()
    for (const segment of reflection.segments) {
      const entry = object(segment)
      if (packet.task === 'reflection_reference_score') allowKeys(entry, ['segment_id', 'order', 'text'])
      text(entry.text)
      if (!Number.isInteger(entry.order) || Number(entry.order) < 0) throw new Error('Ungültige Segmentposition.')
      if (packet.task === 'reflection_reference_score' && (segmentOrders.has(Number(entry.order)) || !Number.isSafeInteger(entry.order))) throw new Error('Segmentpositionen müssen eindeutig und ganzzahlig sein.')
      segmentOrders.add(Number(entry.order))
    }
    const rubric = object(packet.rubric)
    if (packet.task === 'reflection_reference_score') allowKeys(rubric, ['version', 'dimensions'])
    text(rubric.version)
    if (!Array.isArray(rubric.dimensions)) throw new Error('Ungültiges Bewertungsraster.')
    identifiers(rubric.dimensions, 'dimension_id')
    for (const dimension of rubric.dimensions) {
      const entry = object(dimension)
      if (packet.task === 'reflection_reference_score') allowKeys(entry, ['dimension_id', 'name', 'description', 'bands'])
      text(entry.name)
      text(entry.description)
      Object.values(object(entry.bands)).forEach(text)
    }
    if (packet.task === 'reflection_reference_score') {
      const segmentIds = new Set(reflection.segments.map(segment => String(object(segment).segment_id)))
      const rubricIds = new Set(rubric.dimensions.map(dimension => String(object(dimension).dimension_id)))
      if (!Array.isArray(packet.score_dimensions) || !packet.score_dimensions.length) throw new Error('Bewertungsdimensionen fehlen.')
      identifiers(packet.score_dimensions, 'dimension_id')
      if (packet.score_dimensions.length !== rubricIds.size) throw new Error('Bewertungsdimensionen stimmen nicht mit dem Raster überein.')
      for (const dimension of packet.score_dimensions) {
        const entry = object(dimension)
        allowKeys(entry, ['dimension_id', 'label'])
        text(entry.label)
        if (!rubricIds.has(String(entry.dimension_id))) throw new Error('Bewertungsdimension fehlt im Raster.')
      }
      for (const dimension of rubric.dimensions) {
        const entry = object(dimension)
        const bands = object(entry.bands)
        const bandKeys = Object.keys(bands)
        const numericBands = bandKeys.map(Number)
        if (!bandKeys.length || bandKeys.some((key, index) => !/^-?\d+$/.test(key) || !Number.isSafeInteger(numericBands[index])) || new Set(numericBands).size !== bandKeys.length) throw new Error('Bewertungsraster benötigt numerische Punktwertanker.')
        if ([0, 1, 2, 3].some(anchor => !Object.hasOwn(bands, String(anchor))) || numericBands.some(anchor => anchor < 0 || anchor > 3)) throw new Error('Jede Referenzdimension benötigt die Rubrikanker 0 bis 3.')
      }
      if (packet.segment_annotations !== undefined) {
        if (!Array.isArray(packet.segment_annotations)) throw new Error('Ungültige Segmentannotationen.')
        for (const annotation of packet.segment_annotations) {
          const entry = object(annotation)
          const keys = ['segment_id', 'dimension_id', 'skill_label', 'level']
          if (Object.keys(entry).some(key => !keys.includes(key)) || !Object.hasOwn(entry, 'segment_id') || !Object.hasOwn(entry, 'dimension_id')) throw new Error('Ungültige Segmentannotation.')
          text(entry.segment_id)
          text(entry.dimension_id)
          if (!segmentIds.has(entry.segment_id) || !rubricIds.has(entry.dimension_id)) throw new Error('Segmentannotation verweist auf eine unbekannte Reflexion oder Dimension.')
          if (entry.skill_label !== undefined) text(entry.skill_label)
          if (entry.level !== undefined) text(entry.level)
        }
      }
    } else if (packet.task === 'feedback_implied_score') {
      text(packet.human_feedback)
      if (!Array.isArray(packet.score_dimensions) || !packet.score_dimensions.length) throw new Error('Dimensionen fehlen.')
      identifiers(packet.score_dimensions, 'dimension_id')
      packet.score_dimensions.forEach(dimension => text(object(dimension).label))
    } else {
      if (!Array.isArray(packet.criteria) || !packet.criteria.length) throw new Error('Kriterien fehlen.')
      identifiers(packet.criteria, 'criterion_id')
      for (const criterion of packet.criteria) {
        const entry = object(criterion)
        text(entry.label)
        text(entry.description)
        if (entry.anchors !== undefined) Object.values(object(entry.anchors)).forEach(text)
      }
      if (packet.scale !== undefined) {
        const scale = object(packet.scale)
        if (!Number.isInteger(scale.min) || !Number.isInteger(scale.max) || Number(scale.min) > Number(scale.max) || Number(scale.max) - Number(scale.min) > 100) throw new Error('Ungültige Bewertungsskala.')
        Object.values(object(scale.anchors)).forEach(text)
      }
      const output = object(packet.output)
      if (packet.task === 'assessment_quality') {
        if (!Array.isArray(output.dimensions)) throw new Error('Einschätzungsdimensionen fehlen.')
        identifiers(output.dimensions, 'dimension_id')
        for (const dimension of output.dimensions) {
          const entry = object(dimension)
          if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) throw new Error('Ungültiger Punktwert.')
          text(entry.justification)
          if (!Array.isArray(entry.evidence_segment_ids) || !entry.evidence_segment_ids.every(id => typeof id === 'string')) throw new Error('Ungültige Beleg-IDs.')
        }
      } else {
        for (const component of ['strengths', 'weaknesses', 'suggestions']) {
          if (!Array.isArray(output[component])) throw new Error('Feedbackabschnitt fehlt.')
          for (const feedback of output[component] as unknown[]) {
            const entry = object(feedback)
            text(entry.text)
            if (entry.evidence_segment_ids !== undefined && (!Array.isArray(entry.evidence_segment_ids) || !entry.evidence_segment_ids.every(id => typeof id === 'string'))) throw new Error('Ungültige Beleg-IDs.')
          }
        }
      }
    }
    for (const field of ['display_output_sha256', 'displayed_reflection_sha256']) {
      if (packet[field] !== undefined && (typeof packet[field] !== 'string' || !/^[a-f0-9]{64}$/.test(packet[field] as string))) throw new Error('Ungültige Prüfsumme.')
    }
  }
  const linkedReflections = new Map<string, Packet[]>()
  for (const packet of value as Packet[]) {
    if (!packet.reflection_id) continue
    const linked = linkedReflections.get(packet.reflection_id) ?? []
    linked.push(packet)
    linkedReflections.set(packet.reflection_id, linked)
  }
  for (const linked of linkedReflections.values()) {
    const first = linked[0]
    if (linked.some(packet => canonicalJson(packet.reflection) !== canonicalJson(first.reflection)
      || packet.rubric.version !== first.rubric.version)) {
      throw new Error('Verknüpfte Reflexionspakete müssen identische Reflexionsinhalte und kompatible Rubrikversionen haben.')
    }
  }
  return JSON.parse(JSON.stringify(value)) as Packet[]
}

export function finalizedAssessmentReference(packet: Packet, session: ExpertSession): AssessmentReferenceSnapshot | null {
  if (packet.task !== 'assessment_quality' || !packet.reflection_id || session.evaluation_mode !== 'expert_consensus') return null
  const matches = session.packets.filter(candidate => candidate.task === 'reflection_reference_score'
    && candidate.reflection_id === packet.reflection_id)
  if (matches.length !== 1) return null
  const referencePacket = matches[0]
  if (canonicalJson(referencePacket.reflection) !== canonicalJson(packet.reflection)
    || referencePacket.rubric.version !== packet.rubric.version) return null
  const consensus = session.consensus?.[referencePacket.packet_id]
  const draft = session.drafts[referencePacket.packet_id]
  if (consensus?.status !== 'finalized' || !consensus.finalized_at || !draft) return null
  const scores: Record<string, number> = {}
  for (const dimension of referencePacket.score_dimensions ?? []) {
    const score = draft.referenceAnswers[dimension.dimension_id]?.score
    if (typeof score !== 'number' || !isValidReferenceScore(score)) return null
    scores[dimension.dimension_id] = score
  }
  if (Object.keys(scores).length !== (referencePacket.score_dimensions?.length ?? 0)) return null
  return { packet_id: referencePacket.packet_id, finalized_at: consensus.finalized_at, scores }
}

export function assessmentReferenceState(packet: Packet, session: ExpertSession) {
  const record = session.assessment_reference_snapshots?.[packet.packet_id]
  const current = finalizedAssessmentReference(packet, session)
  if (!packet.reflection_id) return { state: 'unlinked' as const, snapshot: null, current: null }
  if (record?.used_snapshot) {
    if (current && canonicalJson(current) === canonicalJson(record.used_snapshot)) return { state: 'current' as const, snapshot: record.used_snapshot, current }
    if (current && record.reviewed_snapshot && canonicalJson(current) === canonicalJson(record.reviewed_snapshot)) return { state: 'reviewed' as const, snapshot: record.used_snapshot, current }
    return { state: 'changed' as const, snapshot: record.used_snapshot, current }
  }
  if (record?.reviewed_snapshot && current && canonicalJson(current) === canonicalJson(record.reviewed_snapshot)) {
    return { state: 'reviewed' as const, snapshot: null, current }
  }
  return current
    ? { state: 'available' as const, snapshot: null, current }
    : { state: 'unavailable' as const, snapshot: null, current: null }
}

export function emptyAssessmentReferences(packets: Packet[]): Record<string, AssessmentReferenceRecord> {
  return Object.fromEntries(packets.filter(packet => packet.task === 'assessment_quality').map(packet => [packet.packet_id, {
    used_snapshot: null, reviewed_snapshot: null, reviewed_at: null,
  }]))
}

export function captureAssessmentReference(packet: Packet, session: ExpertSession): AssessmentReferenceRecord {
  const previous = session.assessment_reference_snapshots?.[packet.packet_id]
    ?? { used_snapshot: null, reviewed_snapshot: null, reviewed_at: null }
  return previous.used_snapshot
    ? previous
    : { ...previous, used_snapshot: finalizedAssessmentReference(packet, session) }
}

export async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function bundleHash(packets: Packet[]) {
  return sha256(JSON.parse(JSON.stringify(packets)).sort((left: Packet, right: Packet) => left.packet_id < right.packet_id ? -1 : left.packet_id > right.packet_id ? 1 : 0))
}

export async function checkPacketHashes(packets: Packet[]) {
  for (const packet of packets) {
    if (packet.displayed_reflection_sha256 && await sha256(packet.reflection) !== packet.displayed_reflection_sha256) throw new Error('Die Prüfsumme einer Reflexion stimmt nicht mit dem angezeigten Inhalt überein.')
    if (packet.display_output_sha256 && await sha256(packet.output ?? packet.human_feedback) !== packet.display_output_sha256) throw new Error('Die Prüfsumme einer Ausgabe stimmt nicht mit dem angezeigten Inhalt überein.')
  }
}

function score(value: unknown) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Punktwerte müssen endlich oder null sein.')
}

function span(value: unknown, source: string) {
  const entry = object(value)
  if (!Number.isInteger(entry.start_character) || !Number.isInteger(entry.end_character)
    || Number(entry.start_character) < 0 || Number(entry.end_character) <= Number(entry.start_character)
    || Number(entry.end_character) > source.length) throw new Error('Ungültige Textausschnittposition.')
  return source.slice(Number(entry.start_character), Number(entry.end_character))
}

export function validateDraft(packet: Packet, value: unknown): Draft {
  const source = object(value)
  const requiredDraftFields = ['criterionRatings', 'scoreAnswers', 'overallComment', 'spanComments']
  if (requiredDraftFields.some(field => !Object.hasOwn(source, field)) || Object.keys(source).some(field => ![...requiredDraftFields, 'referenceAnswers'].includes(field))) throw new Error('Unbekannte oder fehlende Felder in der Sitzung.')
  const draft: Record<string, unknown> = { ...source, referenceAnswers: source.referenceAnswers ?? emptyDraft(packet).referenceAnswers }
  text(draft.overallComment)
  const criteria = exact(draft.criterionRatings, Object.keys(emptyDraft(packet).criterionRatings))
  for (const criterion of packet.criteria ?? []) {
    const answer = exact(criteria[criterion.criterion_id], ['score', 'unable_to_judge', 'comment'])
    score(answer.score)
    text(answer.comment)
    if (typeof answer.unable_to_judge !== 'boolean' || (answer.unable_to_judge && answer.score !== null)) throw new Error('Ungültige Beurteilbarkeit.')
    if (answer.score !== null && (!Number.isInteger(answer.score) || Number(answer.score) < (packet.scale?.min ?? 1) || Number(answer.score) > (packet.scale?.max ?? 5))) throw new Error('Punktwert liegt außerhalb der Skala.')
  }
  const answers = exact(draft.scoreAnswers, Object.keys(emptyDraft(packet).scoreAnswers))
  for (const dimension of packet.task === 'feedback_implied_score' ? packet.score_dimensions ?? [] : []) {
    const answer = exact(answers[dimension.dimension_id], ['status', 'score', 'confidence', 'rationale', 'feedback_evidence'])
    if (typeof answer.status !== 'string' || !['unanswered', 'inferred_from_feedback', 'not_inferable'].includes(answer.status)
      || typeof answer.confidence !== 'string' || !['low', 'medium', 'high', 'not_inferable'].includes(answer.confidence)) throw new Error('Ungültiger Antwortstatus oder Sicherheit.')
    score(answer.score)
    text(answer.rationale)
    if (!Array.isArray(answer.feedback_evidence)) throw new Error('Ungültige Punktwertbelege.')
    if (answer.status !== 'inferred_from_feedback' && (answer.score !== null || answer.confidence !== 'not_inferable' || answer.feedback_evidence.length)) throw new Error('Nicht ableitbare oder offene Antworten dürfen keinen Punktwert enthalten.')
    if (answer.score !== null && (Number(answer.score) < 0 || Number(answer.score) > 3 || Math.abs(Number(answer.score) * 10 - Math.round(Number(answer.score) * 10)) > 1e-8)) throw new Error('Ungültiger abgeleiteter Punktwert.')
    for (const evidence of answer.feedback_evidence) {
      const entry = exact(evidence, ['start_character', 'end_character', 'quote'])
      if (entry.quote !== span(entry, packet.human_feedback ?? '')) throw new Error('Textbeleg stimmt nicht mit der Quelle überein.')
    }
  }
  const referenceAnswers = exact(draft.referenceAnswers, Object.keys(emptyDraft(packet).referenceAnswers))
  const segmentIds = new Set(packet.reflection.segments.map(segment => segment.segment_id))
  for (const dimension of packet.task === 'reflection_reference_score' ? packet.score_dimensions ?? [] : []) {
    const answer = exact(referenceAnswers[dimension.dimension_id], ['score', 'rationale', 'evidence_segment_ids'])
    score(answer.score)
    text(answer.rationale)
    const rubricDimension = packet.rubric.dimensions.find(item => item.dimension_id === dimension.dimension_id)
    if (answer.score !== null && !isValidReferenceScore(answer.score)) throw new Error('Referenzpunktwerte müssen zwischen 0 und 3 in Schritten von 0,5 liegen.')
    if (answer.score !== null && !rubricDimension) throw new Error('Punktwert liegt außerhalb des Bewertungsrasters.')
    if (!Array.isArray(answer.evidence_segment_ids) || !answer.evidence_segment_ids.every(id => typeof id === 'string' && segmentIds.has(id)) || new Set(answer.evidence_segment_ids).size !== answer.evidence_segment_ids.length) throw new Error('Ungültige Reflexionsbelege.')
  }
  if (!Array.isArray(draft.spanComments)) throw new Error('Ungültige Textkommentare.')
  for (const comment of draft.spanComments) {
    const entry = exact(comment, ['feedback_component', 'feedback_item_index', 'start_character', 'end_character', 'comment', 'tags', 'linked_reflection_segment_ids'])
    text(entry.comment)
    text(entry.feedback_component)
    if (!Number.isInteger(entry.feedback_item_index) || Number(entry.feedback_item_index) < 0) throw new Error('Ungültiger Feedbackindex.')
    let source: string | undefined
    if (packet.task === 'feedback_implied_score' && entry.feedback_component === 'human_feedback' && entry.feedback_item_index === 0) source = packet.human_feedback
    if (packet.task === 'feedback_quality' && ['strengths', 'weaknesses', 'suggestions'].includes(String(entry.feedback_component))) source = packet.output?.[entry.feedback_component as 'strengths' | 'weaknesses' | 'suggestions']?.[Number(entry.feedback_item_index)]?.text
    if (source === undefined) throw new Error('Textkommentar hat keine gültige Quelle.')
    span(entry, source)
    if (!Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string' && tags.includes(tag)) || new Set(entry.tags).size !== entry.tags.length) throw new Error('Ungültige Kommentar-Tags.')
    if (!Array.isArray(entry.linked_reflection_segment_ids) || !entry.linked_reflection_segment_ids.every(id => typeof id === 'string' && segmentIds.has(id)) || new Set(entry.linked_reflection_segment_ids).size !== entry.linked_reflection_segment_ids.length) throw new Error('Ungültige Reflexionsbelege.')
  }
  return JSON.parse(JSON.stringify({ ...source, referenceAnswers })) as Draft
}

export function validatePendingEditor(packet: Packet, value: unknown): PendingEditor {
  const editor = exact(value, ['selection', 'comment', 'tags'])
  text(editor.comment)
  if (!Array.isArray(editor.tags) || !editor.tags.every(tag => typeof tag === 'string' && tags.includes(tag)) || new Set(editor.tags).size !== editor.tags.length) throw new Error('Ungültige Kommentar-Tags.')
  if (editor.selection !== null) {
    const selection = exact(editor.selection, ['component', 'index', 'start', 'end', 'quote'])
    text(selection.component)
    text(selection.quote)
    if (!Number.isInteger(selection.index) || Number(selection.index) < 0) throw new Error('Ungültiger Feedbackindex.')
    let source: string | undefined
    if (packet.task === 'feedback_implied_score' && selection.component === 'human_feedback' && selection.index === 0) source = packet.human_feedback
    if (packet.task === 'feedback_quality' && ['strengths', 'weaknesses', 'suggestions'].includes(selection.component)) source = packet.output?.[selection.component as 'strengths' | 'weaknesses' | 'suggestions']?.[Number(selection.index)]?.text
    if (source === undefined) throw new Error('Textauswahl hat keine gültige Quelle.')
    if (selection.quote !== span({ start_character: selection.start, end_character: selection.end }, source)) throw new Error('Textauswahl stimmt nicht mit der Quelle überein.')
  }
  return JSON.parse(JSON.stringify(value)) as PendingEditor
}

export function expertCaseState(packet: Packet, session: Pick<ExpertSession, 'drafts' | 'pending_editors'>) {
  const state = caseState(packet, session.drafts[packet.packet_id])
  return state === 'not_started' && session.pending_editors?.[packet.packet_id]?.comment.trim() ? 'in_progress' : state
}

export function legacyDraft(packet: Packet, value: unknown): Draft {
  const draft = validateDraft(packet, value)
  for (const answer of Object.values(draft.scoreAnswers)) {
    if (answer.status === 'not_inferable' && answer.score === null && answer.confidence === 'not_inferable' && !answer.rationale.trim() && !answer.feedback_evidence.length) answer.status = 'unanswered'
  }
  return draft
}

function validTimestamp(value: unknown) {
  text(value)
  return Number.isFinite(Date.parse(value)) && !Number.isNaN(Date.parse(value))
}

function validateConsensusRecords(value: unknown, packets: Packet[], drafts: Record<string, Draft>, panelId: string): Record<string, ConsensusRecord> {
  const eligiblePackets = packets.filter(packet => consensusTasks.includes(packet.task))
  if (!eligiblePackets.length) throw new Error('Konsenssitzungen benötigen mindestens einen der drei primären Bewertungstypen.')
  const records = exact(value, eligiblePackets.map(packet => packet.packet_id))
  return Object.fromEntries(eligiblePackets.map(packet => {
    const entry = exact(records[packet.packet_id], ['status', 'note', 'finalized_at', 'finalized_by', 'finalization_history'])
    text(entry.status)
    if (!['in_progress', 'flagged', 'finalized'].includes(entry.status)) throw new Error('Ungültiger Konsensstatus.')
    text(entry.note)
    if (!Array.isArray(entry.finalization_history)) throw new Error('Ungültiger Finalisierungsverlauf.')
    const history = entry.finalization_history.map(item => {
      const finalization = exact(item, ['finalized_at', 'finalized_by'])
      if (!validTimestamp(finalization.finalized_at)) throw new Error('Ungültiger früherer Finalisierungszeitpunkt.')
      if (panelIdentifier(finalization.finalized_by) !== panelId) throw new Error('Frühere Konsensmetadaten gehören zu einem anderen Panel.')
      return { finalized_at: finalization.finalized_at, finalized_by: finalization.finalized_by } as ConsensusHistoryEntry
    })
    if (entry.status === 'finalized') {
      if (!validTimestamp(entry.finalized_at) || panelIdentifier(entry.finalized_by) !== panelId) throw new Error('Finalisierter Konsens benötigt Zeitpunkt und Panel-ID.')
      if (consensusAnswerErrors(packet, drafts[packet.packet_id]).length) throw new Error('Unvollständige Antworten können nicht als Konsens finalisiert werden.')
    } else if (entry.finalized_at !== null || entry.finalized_by !== null) {
      throw new Error('Nicht finalisierte Fälle dürfen keine aktuelle Finalisierung enthalten.')
    }
    return [packet.packet_id, { status: entry.status as ConsensusRecord['status'], note: entry.note, finalized_at: entry.finalized_at as string | null, finalized_by: entry.finalized_by as string | null, finalization_history: history }]
  }))
}

function validateAssessmentReferences(value: unknown, packets: Packet[]): Record<string, AssessmentReferenceRecord> {
  const assessmentPackets = packets.filter(packet => packet.task === 'assessment_quality')
  const records = exact(value, assessmentPackets.map(packet => packet.packet_id))
  function snapshot(value: unknown, packet: Packet): AssessmentReferenceSnapshot {
    const entry = exact(value, ['packet_id', 'finalized_at', 'scores'])
    text(entry.packet_id)
    if (!validTimestamp(entry.finalized_at)) throw new Error('Ungültiger Finalisierungszeitpunkt der Referenzbewertung.')
    const finalizedAt = entry.finalized_at as string
    const source = packets.find(candidate => candidate.packet_id === entry.packet_id)
    if (!source || source.task !== 'reflection_reference_score' || !packet.reflection_id
      || source.reflection_id !== packet.reflection_id || source.rubric.version !== packet.rubric.version
      || canonicalJson(source.reflection) !== canonicalJson(packet.reflection)) throw new Error('Referenzsnapshot verweist auf eine unpassende Reflexion.')
    const scores = object(entry.scores)
    const expectedDimensions = (source.score_dimensions ?? []).map(dimension => dimension.dimension_id)
    if (canonicalJson(Object.keys(scores).sort()) !== canonicalJson([...expectedDimensions].sort())) throw new Error('Referenzsnapshot enthält unvollständige Dimensionen.')
    for (const dimensionId of expectedDimensions) {
      score(scores[dimensionId])
      if (!isValidReferenceScore(scores[dimensionId])) throw new Error('Referenzsnapshot enthält einen ungültigen Punktwert.')
    }
    return { packet_id: entry.packet_id, finalized_at: finalizedAt, scores: scores as Record<string, number> }
  }
  return Object.fromEntries(assessmentPackets.map(packet => {
    const entry = exact(records[packet.packet_id], ['used_snapshot', 'reviewed_snapshot', 'reviewed_at'])
    const usedSnapshot = entry.used_snapshot === null ? null : snapshot(entry.used_snapshot, packet)
    const reviewedSnapshot = entry.reviewed_snapshot === null ? null : snapshot(entry.reviewed_snapshot, packet)
    if (entry.reviewed_at !== null && !validTimestamp(entry.reviewed_at)) throw new Error('Ungültiger Zeitpunkt der Referenzprüfung.')
    if ((reviewedSnapshot === null) !== (entry.reviewed_at === null)) throw new Error('Referenzprüfung benötigt Snapshot und Zeitpunkt.')
    return [packet.packet_id, {
      used_snapshot: usedSnapshot,
      reviewed_snapshot: reviewedSnapshot,
      reviewed_at: entry.reviewed_at as string | null,
    }]
  }))
}

export async function validateSession(value: unknown): Promise<ExpertSession> {
  const rawSession = object(value)
  const hasEditors = Object.hasOwn(rawSession, 'pending_editors')
  const isConsensus = rawSession.schema_version === '1.1.0' || rawSession.schema_version === '1.2.0'
  const isReferenceAwareConsensus = rawSession.schema_version === '1.2.0'
  const baseFields = ['kind', 'schema_version', 'evaluator_id', 'bundle_sha256', 'packets', 'drafts', 'active_task', 'active_index', 'active_criterion']
  const session = isConsensus
    ? allowKeys(rawSession, [...baseFields, 'evaluation_mode', 'panel_id', 'consensus'], ['pending_editors', 'panel_members', ...(isReferenceAwareConsensus ? ['assessment_reference_snapshots'] : [])])
    : exact(rawSession, [...baseFields, ...(hasEditors ? ['pending_editors'] : [])])
  if (session.kind !== 'prebi_expert_session' || !['1.0.0', '1.1.0', '1.2.0'].includes(String(session.schema_version))) throw new Error('Unbekanntes Sitzungsformat.')
  text(session.evaluator_id)
  if (!session.evaluator_id.trim() || session.evaluator_id !== session.evaluator_id.trim()) throw new Error('Bewertungscode fehlt oder ist ungültig.')
  let panelId: string | undefined
  if (isConsensus) {
    if (session.evaluation_mode !== 'expert_consensus') throw new Error('Unbekannter Bewertungsmodus.')
    panelId = panelIdentifier(session.panel_id)
    if (panelId !== session.evaluator_id) throw new Error('Panel-ID und Sitzungskennung müssen übereinstimmen.')
    if (session.panel_members !== undefined) {
      if (!Array.isArray(session.panel_members)) throw new Error('Ungültige Panel-Mitglieder.')
      const members = session.panel_members.map(panelIdentifier)
      if (new Set(members).size !== members.length) throw new Error('Panel-Mitglieder müssen eindeutig sein.')
    }
  }
  const packets = validatePackets(session.packets)
  if (isConsensus) assertConsensusBlinding(packets)
  await checkPacketHashes(packets)
  if (session.bundle_sha256 !== await bundleHash(packets)) throw new Error('Sitzungsprüfsumme stimmt nicht mit den Paketen überein.')
  const drafts = exact(session.drafts, packets.map(packet => packet.packet_id))
  const validatedDrafts = Object.fromEntries(packets.map(packet => [packet.packet_id, (hasEditors ? validateDraft : legacyDraft)(packet, drafts[packet.packet_id])]))
  let pendingEditors: Record<string, PendingEditor> | undefined
  if (hasEditors) {
    const editors = object(session.pending_editors)
    pendingEditors = Object.fromEntries(Object.entries(editors).map(([id, editor]) => {
      const packet = packets.find(item => item.packet_id === id)
      if (!packet) throw new Error('Texteditor hat keine gültige Fall-ID.')
      return [id, validatePendingEditor(packet, editor)]
    }))
  }
  const consensus = isConsensus ? validateConsensusRecords(session.consensus, packets, validatedDrafts, panelId!) : undefined
  const assessmentReferences = isReferenceAwareConsensus
    ? validateAssessmentReferences(session.assessment_reference_snapshots ?? emptyAssessmentReferences(packets), packets)
    : undefined
  const taskPackets = packets.filter(packet => packet.task === session.active_task)
  if (typeof session.active_task !== 'string' || !tasks.includes(session.active_task) || !Number.isInteger(session.active_index) || Number(session.active_index) < 0 || Number(session.active_index) >= taskPackets.length) throw new Error('Ungültige Fallposition.')
  if (isConsensus && session.active_task === 'feedback_implied_score') throw new Error('Der Legacy-Punktwert ist nicht Teil des Konsensworkflows.')
  const activePacket = taskPackets[Number(session.active_index)]
  if (!Number.isInteger(session.active_criterion) || Number(session.active_criterion) < 0 || Number(session.active_criterion) >= evaluationSteps(activePacket).length) throw new Error('Ungültige Kriteriumsposition.')
  return { ...session, packets, drafts: validatedDrafts, ...(hasEditors ? { pending_editors: pendingEditors } : {}), ...(isConsensus ? { consensus } : {}), ...(isReferenceAwareConsensus ? { assessment_reference_snapshots: assessmentReferences } : {}) } as ExpertSession
}

export function sessionKey(session: Pick<ExpertSession, 'evaluator_id' | 'bundle_sha256'> & Partial<Pick<ExpertSession, 'evaluation_mode'>>) {
  return `expert::${session.evaluator_id}::${session.bundle_sha256}${session.evaluation_mode === 'expert_consensus' ? '::consensus' : ''}`
}

export function assertSourcesMatch(packets: Packet[], existing: Packet[]) {
  const sources = new Map(existing.map(packet => [packet.packet_id, canonicalJson(packet)]))
  for (const packet of packets) {
    const source = sources.get(packet.packet_id)
    if (source !== undefined && source !== canonicalJson(packet)) throw new Error(`Fall-ID ${packet.packet_id} ist bereits mit einer anderen Quelle gespeichert.`)
  }
}

export function draftFromResponse(packet: Packet, value: unknown): Draft {
  const response = object(value)
  const draft = emptyDraft(packet)
  if (packet.task === 'reflection_reference_score') {
    if (!Array.isArray(response.scores)) throw new Error('Ungültige Referenzbewertung.')
    const ids = identifiers(response.scores, 'dimension_id')
    if (canonicalJson([...ids].sort()) !== canonicalJson(Object.keys(draft.referenceAnswers).sort())) throw new Error('Referenzdimensionen stimmen nicht mit dem Paket überein.')
    exact(response, ['scores'])
    draft.referenceAnswers = Object.fromEntries(response.scores.map(value => {
      const entry = exact(value, ['dimension_id', 'score', 'rationale', 'evidence_segment_ids'])
      return [String(entry.dimension_id), { score: entry.score as number | null, rationale: entry.rationale as string, evidence_segment_ids: entry.evidence_segment_ids as string[] }]
    }))
    return validateDraft(packet, draft)
  }
  if (packet.task === 'feedback_implied_score') {
    if (!Array.isArray(response.scores)) throw new Error('Ungültige ältere Bewertung.')
    const ids = identifiers(response.scores, 'dimension_id')
    if (canonicalJson([...ids].sort()) !== canonicalJson(Object.keys(draft.scoreAnswers).sort())) throw new Error('Ältere Dimensionen stimmen nicht mit dem Paket überein.')
    draft.scoreAnswers = Object.fromEntries(response.scores.map(value => {
      const { dimension_id, ...answer } = object(value)
      return [String(dimension_id), answer]
    })) as Draft['scoreAnswers']
  } else {
    draft.criterionRatings = response.criterion_ratings as Draft['criterionRatings']
    draft.overallComment = response.overall_comment as string
  }
  draft.spanComments = response.feedback_span_comments as Draft['spanComments']
  return legacyDraft(packet, draft)
}