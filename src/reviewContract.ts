import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { Segment } from './ratingTypes'

export const REVIEW_COMPONENTS = ['strengths', 'weaknesses', 'suggestions'] as const
export type ReviewComponent = typeof REVIEW_COMPONENTS[number]
export type ReviewDecision = 'use_as_generated' | 'use_with_edits' | 'do_not_use'
export type ReviewItem = { item_id: string; text: string; evidence_segment_ids: string[] }
export type ReviewFeedback = Record<ReviewComponent, ReviewItem[]>
export type ReviewPacket = {
  review_packet_id: string
  source_reference: string
  reflection: { segments: Segment[] }
  generated_feedback: ReviewFeedback
}
export type ReviewDraft = {
  feedback: ReviewFeedback
  decision: ReviewDecision | null
  first_edited_at: string | null
  updated_at: string
}
export type ReviewApproval = {
  feedback: ReviewFeedback
  decision: ReviewDecision
  first_edited_at: string | null
  approved_at: string
  editing_to_approval_ms: number | null
}
export type ReviewProgress = {
  reviewer_id: string
  drafts: Record<string, ReviewDraft>
  approvals: Record<string, ReviewApproval>
}
export type ReviewBundle = {
  kind: 'prebi_lecturer_review_bundle'
  schema_version: '1.0.0'
  bundle_id: string
  packets: ReviewPacket[]
  progress?: ReviewProgress
}

const identifier = { type: 'string', minLength: 1, pattern: '\\S' }
const timestamp = { type: 'string', format: 'date-time' }
const nullableTimestamp = { anyOf: [timestamp, { type: 'null' }] }
const decision = { type: 'string', enum: ['use_as_generated', 'use_with_edits', 'do_not_use'] }
const feedback = { type: 'object', additionalProperties: false, required: [...REVIEW_COMPONENTS], properties: Object.fromEntries(REVIEW_COMPONENTS.map(component => [component, { type: 'array', items: { $ref: '#/definitions/item' } }])) }

export const REVIEW_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'PReBi Lecturer Review Bundle 1.0.0',
  type: 'object', additionalProperties: false,
  required: ['kind', 'schema_version', 'bundle_id', 'packets'],
  properties: {
    kind: { const: 'prebi_lecturer_review_bundle' }, schema_version: { const: '1.0.0' }, bundle_id: identifier,
    packets: { type: 'array', minItems: 1, items: { $ref: '#/definitions/packet' } },
    progress: {
      type: 'object', additionalProperties: false, required: ['reviewer_id', 'drafts', 'approvals'],
      properties: {
        reviewer_id: identifier,
        drafts: { type: 'object', additionalProperties: { $ref: '#/definitions/draft' } },
        approvals: { type: 'object', additionalProperties: { $ref: '#/definitions/approval' } },
      },
    },
  },
  definitions: {
    item: { type: 'object', additionalProperties: false, required: ['item_id', 'text', 'evidence_segment_ids'], properties: { item_id: identifier, text: { type: 'string' }, evidence_segment_ids: { type: 'array', uniqueItems: true, items: identifier } } },
    feedback,
    packet: {
      type: 'object', additionalProperties: false, required: ['review_packet_id', 'source_reference', 'reflection', 'generated_feedback'],
      properties: {
        review_packet_id: identifier, source_reference: identifier, generated_feedback: { $ref: '#/definitions/feedback' },
        reflection: { type: 'object', additionalProperties: false, required: ['segments'], properties: { segments: { type: 'array', minItems: 1, items: {
          type: 'object', additionalProperties: false, required: ['segment_id', 'order', 'text'], properties: { segment_id: identifier, order: { type: 'integer', minimum: 0 }, text: { type: 'string', minLength: 1 } },
        } } } },
      },
    },
    draft: { type: 'object', additionalProperties: false, required: ['feedback', 'decision', 'first_edited_at', 'updated_at'], properties: { feedback: { $ref: '#/definitions/feedback' }, decision: { anyOf: [decision, { type: 'null' }] }, first_edited_at: nullableTimestamp, updated_at: timestamp } },
    approval: { type: 'object', additionalProperties: false, required: ['feedback', 'decision', 'first_edited_at', 'approved_at', 'editing_to_approval_ms'], properties: { feedback: { $ref: '#/definitions/feedback' }, decision, first_edited_at: nullableTimestamp, approved_at: timestamp, editing_to_approval_ms: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] } } },
  },
}

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validate = ajv.compile(REVIEW_SCHEMA)

export function sameReviewValue(first: unknown, second: unknown): boolean {
  if (first === second) return true
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false
  if (Array.isArray(first) || Array.isArray(second)) return Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => sameReviewValue(value, second[index]))
  const firstObject = first as Record<string, unknown>
  const secondObject = second as Record<string, unknown>
  const keys = Object.keys(firstObject)
  return keys.length === Object.keys(secondObject).length && keys.every(key => Object.hasOwn(secondObject, key) && sameReviewValue(firstObject[key], secondObject[key]))
}

function checkFeedback(packet: ReviewPacket, value: ReviewFeedback, allowBlank = false) {
  const segments = new Set(packet.reflection.segments.map(segment => segment.segment_id))
  const items = new Set<string>()
  for (const component of REVIEW_COMPONENTS) for (const item of value[component]) {
    if (!allowBlank && !item.text.trim()) throw new Error('Generierte oder freigegebene Feedbackeinträge dürfen nicht leer sein.')
    if (items.has(item.item_id)) throw new Error('Die Kennungen der Feedbackeinträge müssen innerhalb eines Pakets eindeutig sein.')
    items.add(item.item_id)
    if (item.evidence_segment_ids.some(id => !segments.has(id))) throw new Error('Das Feedback verweist auf ein unbekanntes Reflexionssegment.')
  }
}

export function approvalError(packet: ReviewPacket, draft: ReviewDraft): string | null {
  if (!draft.decision) return 'Wählen Sie eine Prüfentscheidung.'
  if (REVIEW_COMPONENTS.some(component => draft.feedback[component].some(item => !item.text.trim()))) return 'Ergänzen oder entfernen Sie leere Feedbackeinträge.'
  if (draft.decision === 'use_as_generated' && !sameReviewValue(draft.feedback, packet.generated_feedback)) return 'Wählen Sie „Mit Änderungen verwenden“ oder stellen Sie das generierte Feedback wieder her.'
  if (draft.decision === 'use_with_edits' && sameReviewValue(draft.feedback, packet.generated_feedback)) return 'Bearbeiten Sie das Feedback oder die Belege oder wählen Sie „Unverändert verwenden“.'
  if (draft.decision !== 'do_not_use' && !REVIEW_COMPONENTS.some(component => draft.feedback[component].length)) return 'Fügen Sie Feedback hinzu, bevor Sie es zur Verwendung freigeben.'
  return null
}

export function parseReviewBundle(value: unknown): ReviewBundle {
  if (!validate(value)) throw new Error(`Ungültiges Prüfungspaket. Die Datei entspricht nicht dem Prüfungsschema. Betroffene Felder: ${(validate.errors ?? []).map(error => `${error.instancePath || '/'}${error.keyword === 'required' ? ` (${String(error.params.missingProperty)})` : ''}`).join('; ')}`)
  const bundle = value as ReviewBundle
  const packets = new Map<string, ReviewPacket>()
  for (const packet of bundle.packets) {
    if (packets.has(packet.review_packet_id)) throw new Error('Die Kennungen der Prüfungspakete müssen eindeutig sein.')
    packets.set(packet.review_packet_id, packet)
    const ids = packet.reflection.segments.map(segment => segment.segment_id)
    const orders = packet.reflection.segments.map(segment => segment.order)
    if (new Set(ids).size !== ids.length || new Set(orders).size !== orders.length) throw new Error('Die Kennungen und Positionsnummern der Reflexionssegmente müssen eindeutig sein.')
    checkFeedback(packet, packet.generated_feedback)
  }
  for (const [id, draft] of Object.entries(bundle.progress?.drafts ?? {})) {
    const packet = packets.get(id)
    if (!packet) throw new Error('Der Entwurf verweist auf ein unbekanntes Prüfungspaket.')
    checkFeedback(packet, draft.feedback, true)
    if (draft.first_edited_at && Date.parse(draft.first_edited_at) > Date.parse(draft.updated_at)) throw new Error('Die erste Änderung darf nicht nach der letzten Entwurfsaktualisierung liegen.')
    if (!sameReviewValue(draft.feedback, packet.generated_feedback) && !draft.first_edited_at) throw new Error('Bearbeitetes Feedback muss den Zeitpunkt der ersten Änderung enthalten.')
  }
  for (const [id, approval] of Object.entries(bundle.progress?.approvals ?? {})) {
    const packet = packets.get(id)
    if (!packet) throw new Error('Die Freigabe verweist auf ein unbekanntes Prüfungspaket.')
    checkFeedback(packet, approval.feedback)
    const message = approvalError(packet, { ...approval, updated_at: approval.approved_at })
    if (message) throw new Error(message)
    const elapsed = approval.first_edited_at ? Date.parse(approval.approved_at) - Date.parse(approval.first_edited_at) : null
    if (elapsed !== approval.editing_to_approval_ms || (elapsed !== null && elapsed < 0)) throw new Error('Die Zeitangaben der Freigabe sind widersprüchlich.')
    if (!sameReviewValue(approval.feedback, packet.generated_feedback) && !approval.first_edited_at) throw new Error('Eine bearbeitete Freigabe muss den Zeitpunkt der ersten Änderung enthalten.')
    const draft = bundle.progress?.drafts[id]
    if (draft && approval.first_edited_at && draft.first_edited_at !== approval.first_edited_at) throw new Error('Entwurf und Freigabe müssen denselben Zeitpunkt der ersten Änderung enthalten.')
  }
  return structuredClone(bundle)
}

export function initialReviewDraft(packet: ReviewPacket, now: string): ReviewDraft {
  return { feedback: structuredClone(packet.generated_feedback), decision: null, first_edited_at: null, updated_at: now }
}

export function editReviewDraft(draft: ReviewDraft, feedback: ReviewFeedback, now: string): ReviewDraft {
  if (sameReviewValue(draft.feedback, feedback)) return draft
  return { ...draft, feedback, decision: 'use_with_edits', first_edited_at: draft.first_edited_at ?? now, updated_at: now }
}

export function approveReview(packet: ReviewPacket, draft: ReviewDraft, now: string): ReviewApproval {
  const message = approvalError(packet, draft)
  if (message) throw new Error(message)
  const elapsed = draft.first_edited_at ? Date.parse(now) - Date.parse(draft.first_edited_at) : null
  if (elapsed !== null && elapsed < 0) throw new Error('Die Freigabe liegt vor der ersten Änderung. Prüfen Sie die Uhrzeit Ihres Geräts.')
  return { feedback: structuredClone(draft.feedback), decision: draft.decision!, first_edited_at: draft.first_edited_at, approved_at: now, editing_to_approval_ms: elapsed }
}

export function reviewIsCurrent(draft: ReviewDraft | undefined, approval: ReviewApproval | undefined) {
  return Boolean(approval && (!draft || (draft.decision === approval.decision && draft.first_edited_at === approval.first_edited_at && sameReviewValue(draft.feedback, approval.feedback))))
}