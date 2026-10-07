import type { Draft, Packet, RatingTask } from './ratingTypes'
import { canonicalJson, caseState, emptyDraft, evaluationSteps } from './ratingValidation'

export type PendingEditor = {
  selection: { component: string; index: number; start: number; end: number; quote: string } | null
  comment: string
  tags: string[]
}

export type ExpertSession = {
  kind: 'prebi_expert_session'
  schema_version: '1.0.0'
  evaluator_id: string
  bundle_sha256: string
  packets: Packet[]
  drafts: Record<string, Draft>
  pending_editors?: Record<string, PendingEditor>
  active_task: RatingTask
  active_index: number
  active_criterion: number
}

const tasks = ['assessment_quality', 'feedback_quality', 'feedback_implied_score']
const tags = ['unsupported', 'inaccurate', 'vague', 'actionable', 'strength', 'concern', 'other']

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiges Sitzungsobjekt.')
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: string[]) {
  const record = object(value)
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new Error('Unbekannte oder fehlende Felder in der Sitzung.')
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

export function validatePackets(value: unknown): Packet[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Die Datei muss verblindete Bewertungspakete enthalten.')
  identifiers(value, 'packet_id')
  for (const item of value) {
    const packet = object(item)
    if (packet.condition_blinded !== true || typeof packet.task !== 'string' || !tasks.includes(packet.task)) throw new Error('Die Datei muss verblindete Bewertungspakete enthalten.')
    for (const field of ['packet_version', 'protocol_id', 'protocol_version', 'human_protocol']) text(packet[field])
    const reflection = object(packet.reflection)
    if (!Array.isArray(reflection.segments)) throw new Error('Ungültige Reflexion.')
    identifiers(reflection.segments, 'segment_id')
    for (const segment of reflection.segments) {
      const entry = object(segment)
      text(entry.text)
      if (!Number.isInteger(entry.order) || Number(entry.order) < 0) throw new Error('Ungültige Segmentposition.')
    }
    const rubric = object(packet.rubric)
    text(rubric.version)
    if (!Array.isArray(rubric.dimensions)) throw new Error('Ungültiges Bewertungsraster.')
    identifiers(rubric.dimensions, 'dimension_id')
    for (const dimension of rubric.dimensions) {
      const entry = object(dimension)
      text(entry.name)
      text(entry.description)
      Object.values(object(entry.bands)).forEach(text)
    }
    if (packet.task === 'feedback_implied_score') {
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
  return JSON.parse(JSON.stringify(value)) as Packet[]
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
  const draft = exact(value, ['criterionRatings', 'scoreAnswers', 'overallComment', 'spanComments'])
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
  for (const dimension of packet.score_dimensions ?? []) {
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
  if (!Array.isArray(draft.spanComments)) throw new Error('Ungültige Textkommentare.')
  const segmentIds = new Set(packet.reflection.segments.map(segment => segment.segment_id))
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
  return JSON.parse(JSON.stringify(value)) as Draft
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

export async function validateSession(value: unknown): Promise<ExpertSession> {
  const hasEditors = Object.hasOwn(object(value), 'pending_editors')
  const session = exact(value, ['kind', 'schema_version', 'evaluator_id', 'bundle_sha256', 'packets', 'drafts', 'active_task', 'active_index', 'active_criterion', ...(hasEditors ? ['pending_editors'] : [])])
  if (session.kind !== 'prebi_expert_session' || session.schema_version !== '1.0.0') throw new Error('Unbekanntes Sitzungsformat.')
  text(session.evaluator_id)
  if (!session.evaluator_id.trim() || session.evaluator_id !== session.evaluator_id.trim()) throw new Error('Bewertungscode fehlt oder ist ungültig.')
  const packets = validatePackets(session.packets)
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
  const taskPackets = packets.filter(packet => packet.task === session.active_task)
  if (typeof session.active_task !== 'string' || !tasks.includes(session.active_task) || !Number.isInteger(session.active_index) || Number(session.active_index) < 0 || Number(session.active_index) >= taskPackets.length) throw new Error('Ungültige Fallposition.')
  const activePacket = taskPackets[Number(session.active_index)]
  if (!Number.isInteger(session.active_criterion) || Number(session.active_criterion) < 0 || Number(session.active_criterion) >= evaluationSteps(activePacket).length) throw new Error('Ungültige Kriteriumsposition.')
  return { ...session, packets, drafts: validatedDrafts, ...(hasEditors ? { pending_editors: pendingEditors } : {}) } as ExpertSession
}

export function sessionKey(session: Pick<ExpertSession, 'evaluator_id' | 'bundle_sha256'>) {
  return `expert::${session.evaluator_id}::${session.bundle_sha256}`
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