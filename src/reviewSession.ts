import { parseReviewBundle, REVIEW_COMPONENTS, reviewIsCurrent, sameReviewValue, type ReviewBundle, type ReviewPacket } from './reviewContract'
import type { CaseState } from './ratingValidation'

export type ReviewAnnotation = {
  status: 'appropriate' | 'problem'
  comment?: string
  alternative?: string
  evidence_segment_ids?: string[]
}

export type ReviewSession = {
  kind: 'prebi_lecturer_session'
  schema_version: '1.0.0'
  bundle: ReviewBundle
  annotations: Record<string, Record<string, ReviewAnnotation>>
  seen_packet_ids: string[]
  activeIndex: number
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Der Prüfungsstand enthält unbekannte Felder.')
}

export function sessionKey(session: ReviewSession): string {
  const reviewer = session.bundle.progress?.reviewer_id
  if (!reviewer) throw new Error('Der Prüfungsstand enthält keinen Prüfungscode.')
  return `review::${reviewer}::${session.bundle.bundle_id}`
}

export function createReviewSession(bundle: ReviewBundle, reviewer: string): ReviewSession {
  const code = bundle.progress?.reviewer_id ?? reviewer.trim()
  if (!code) throw new Error('Geben Sie Ihren Prüfungscode ein, bevor Sie ein Prüfungspaket öffnen.')
  const progress = bundle.progress ?? { reviewer_id: code, drafts: {}, approvals: {} }
  const firstUnfinished = bundle.packets.findIndex(packet => !reviewIsCurrent(progress.drafts[packet.review_packet_id], progress.approvals[packet.review_packet_id]))
  return {
    kind: 'prebi_lecturer_session', schema_version: '1.0.0',
    bundle: { ...bundle, progress },
    annotations: {}, seen_packet_ids: bundle.packets.filter(packet => progress.drafts[packet.review_packet_id] || progress.approvals[packet.review_packet_id]).map(packet => packet.review_packet_id), activeIndex: Math.max(0, firstUnfinished),
  }
}

export function parseReviewSession(value: unknown, reviewer = ''): ReviewSession {
  if (!object(value) || value.kind !== 'prebi_lecturer_session') {
    const bundle = parseReviewBundle(value)
    checkIdentifiers(bundle)
    return createReviewSession(bundle, reviewer)
  }
  fields(value, ['kind', 'schema_version', 'bundle', 'annotations', 'seen_packet_ids', 'activeIndex'])
  if (value.schema_version !== '1.0.0') throw new Error('Nicht unterstützte Version des Prüfungsstands.')
  const bundle = parseReviewBundle(value.bundle)
  checkIdentifiers(bundle)
  if (!bundle.progress) throw new Error('Der Prüfungsstand enthält keinen Prüfungscode.')
  if (!object(value.annotations)) throw new Error('Ungültige Feedbackmarkierungen.')
  const packets = new Map(bundle.packets.map(packet => [packet.review_packet_id, packet]))
  for (const [packetId, annotations] of Object.entries(value.annotations)) {
    const packet = packets.get(packetId)
    if (!packet || !object(annotations)) throw new Error('Feedbackmarkierungen verweisen auf einen unbekannten Fall.')
    const feedbackVersions = [packet.generated_feedback, bundle.progress.drafts[packetId]?.feedback, bundle.progress.approvals[packetId]?.feedback]
    const itemIds = new Set(feedbackVersions.flatMap(feedback => feedback ? REVIEW_COMPONENTS.flatMap(component => feedback[component].map(item => item.item_id)) : []))
    const segmentIds = new Set(packet.reflection.segments.map(segment => segment.segment_id))
    for (const [itemId, annotation] of Object.entries(annotations)) {
      if (!itemIds.has(itemId) || !object(annotation)) throw new Error('Feedbackmarkierungen verweisen auf einen unbekannten Eintrag.')
      fields(annotation, ['status', 'comment', 'alternative', 'evidence_segment_ids'])
      if (annotation.status !== 'appropriate' && annotation.status !== 'problem') throw new Error('Ungültiger Status einer Feedbackmarkierung.')
      for (const field of ['comment', 'alternative']) {
        if (Object.hasOwn(annotation, field) && typeof annotation[field] !== 'string') throw new Error('Kommentar und Alternative müssen Text enthalten.')
      }
      if (Object.hasOwn(annotation, 'evidence_segment_ids')) {
        const ids = annotation.evidence_segment_ids
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !segmentIds.has(id)) || new Set(ids).size !== ids.length) throw new Error('Eine Feedbackmarkierung enthält ungültige Belege.')
      }
    }
  }
  if (!Array.isArray(value.seen_packet_ids) || value.seen_packet_ids.some(id => typeof id !== 'string' || !packets.has(id)) || new Set(value.seen_packet_ids).size !== value.seen_packet_ids.length) throw new Error('Ungültige Liste gesehener Fälle.')
  if (!Number.isInteger(value.activeIndex) || (value.activeIndex as number) < 0 || (value.activeIndex as number) >= bundle.packets.length) throw new Error('Ungültige Fallposition im Prüfungsstand.')
  return structuredClone(value) as ReviewSession
}

function checkIdentifiers(bundle: ReviewBundle) {
  const reserved = new Set(['__proto__', 'constructor', 'prototype'])
  for (const packet of bundle.packets) {
    if (reserved.has(packet.review_packet_id)) throw new Error('Ungültige Fallkennung.')
    for (const feedback of [packet.generated_feedback, bundle.progress?.drafts[packet.review_packet_id]?.feedback, bundle.progress?.approvals[packet.review_packet_id]?.feedback]) {
      if (feedback && REVIEW_COMPONENTS.some(component => feedback[component].some(item => reserved.has(item.item_id)))) throw new Error('Ungültige Feedbackkennung.')
    }
  }
}

export function visitReviewPacket(session: ReviewSession, activeIndex: number): ReviewSession {
  const id = session.bundle.packets[activeIndex]?.review_packet_id
  if (!id) throw new Error('Unbekannter Fall.')
  return { ...session, activeIndex, seen_packet_ids: session.seen_packet_ids.includes(id) ? session.seen_packet_ids : [...session.seen_packet_ids, id] }
}

export function packetDraftItems(session: ReviewSession, packet: ReviewPacket): Set<string> {
  const feedback = session.bundle.progress?.drafts[packet.review_packet_id]?.feedback ?? session.bundle.progress?.approvals[packet.review_packet_id]?.feedback ?? packet.generated_feedback
  return new Set(REVIEW_COMPONENTS.flatMap(component => feedback[component].map(item => item.item_id)))
}

export function feedbackCount(session: ReviewSession): number {
  return Object.values(session.annotations).reduce((total, items) => total + Object.keys(items).length, 0)
}

export function reviewCaseState(session: ReviewSession, packet: ReviewPacket): CaseState {
  const id = packet.review_packet_id
  const draft = session.bundle.progress?.drafts[id]
  if (Object.keys(session.annotations[id] ?? {}).length || session.bundle.progress?.approvals[id]
    || draft && (draft.decision !== null || !sameReviewValue(draft.feedback, packet.generated_feedback))) return 'complete'
  return session.seen_packet_ids.includes(id) || draft ? 'in_progress' : 'not_started'
}