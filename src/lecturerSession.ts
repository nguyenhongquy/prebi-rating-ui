import Ajv from 'ajv'
import { canonicalJson } from './ratingValidation'

export const DIMENSIONS = ['SW', 'UA', 'HA'] as const
export const CONDITIONS = ['G1', 'G2'] as const
export const CATEGORIES = ['strengths', 'weaknesses', 'suggestions'] as const
export const MAX_BACKUP_BYTES = 5_000_000
export type Dimension = typeof DIMENSIONS[number]
export type Condition = typeof CONDITIONS[number]
export type Category = typeof CATEGORIES[number]
export type Preference = Condition | 'tie' | 'neither'
export type Scores = Record<Dimension, number | null>
export type LecturerItem = { id: string; category: Category; text: string; evidence: string[]; source: { candidateId: string; itemId: string } | null }
export type PreparedCase = {
  documentId: string
  segments: { segment_id: string; order: number; text: string; prediction: Record<Dimension, number> }[]
  rubric: { id: string; version: string; guidance: string }
  provenance: 'synthetic-fake-v1'
}
export type Candidate = { id: string; condition: Condition; documentId: string; rubricId: string; rubricVersion: string; items: LecturerItem[]; provenance: 'synthetic-fake-v1' }
type Attempt = { status: 'idle' | 'pending' | 'succeeded' | 'failed' | 'interrupted'; attemptId: string | null; error: string | null; result: Candidate | null }
type Draft = { revision: number; comparisonRevision: number; items: LecturerItem[] }
type Approval = { draft: Draft; comparisonRevision: number; candidateIds: string[]; preference: Preference; approvedAt: string }
export type LecturerSession = {
  kind: 'prebi_lecturer_workflow'
  schema_version: '1.0.0'
  id: string
  revision: number
  prepared: PreparedCase
  scores: Scores
  confirmedAt: string | null
  candidates: Record<Condition, Attempt>
  comparison: { preference: Preference; revision: number; candidateIds: string[] } | null
  draft: Draft | null
  approvals: Approval[]
}

const identifier = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9._:-]+$' }
const timestamp = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$' }
const integer = { type: 'integer', minimum: 0 }
const text = { type: 'string', maxLength: 20000 }
const ref = (name: string) => ({ $ref: `#/$defs/${name}` })
const array = (items: object, maxItems = 500) => ({ type: 'array', items, maxItems })
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })
const record = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const score = { enum: [0, 0.5, 1, 1.5, 2, 2.5, 3, null] }
const schema = {
  ...record({
    kind: { const: 'prebi_lecturer_workflow' }, schema_version: { const: '1.0.0' }, id: identifier, revision: integer,
    prepared: ref('prepared'), scores: record({ SW: score, UA: score, HA: score }), confirmedAt: nullable(timestamp),
    candidates: record({ G1: ref('attempt'), G2: ref('attempt') }), comparison: nullable(ref('comparison')),
    draft: nullable(ref('draft')), approvals: array(ref('approval')),
  }),
  $defs: {
    item: record({ id: identifier, category: { enum: CATEGORIES }, text, evidence: { ...array(identifier), uniqueItems: true }, source: nullable(record({ candidateId: identifier, itemId: identifier })) }),
    prepared: record({
      documentId: identifier,
      segments: { ...array(record({ segment_id: identifier, order: integer, text: { ...text, minLength: 1 }, prediction: record({ SW: { enum: [0, 1, 2, 3] }, UA: { enum: [0, 1, 2, 3] }, HA: { enum: [0, 1, 2, 3] } }) })), minItems: 1 },
      rubric: record({ id: identifier, version: identifier, guidance: { ...text, minLength: 1 } }), provenance: { const: 'synthetic-fake-v1' },
    }),
    candidate: record({ id: identifier, condition: { enum: CONDITIONS }, documentId: identifier, rubricId: identifier, rubricVersion: identifier, items: { ...array(ref('item')), minItems: 1 }, provenance: { const: 'synthetic-fake-v1' } }),
    attempt: record({ status: { enum: ['idle', 'pending', 'succeeded', 'failed', 'interrupted'] }, attemptId: nullable(identifier), error: nullable(text), result: nullable(ref('candidate')) }),
    comparison: record({ preference: { enum: ['G1', 'G2', 'tie', 'neither'] }, revision: { type: 'integer', minimum: 1 }, candidateIds: { ...array(identifier, 2), minItems: 2, uniqueItems: true } }),
    draft: record({ revision: { type: 'integer', minimum: 1 }, comparisonRevision: { type: 'integer', minimum: 1 }, items: array(ref('item')) }),
    approval: record({ draft: ref('draft'), comparisonRevision: { type: 'integer', minimum: 1 }, candidateIds: { ...array(identifier, 2), minItems: 2, uniqueItems: true }, preference: { enum: ['G1', 'G2', 'tie', 'neither'] }, approvedAt: timestamp }),
  },
}
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile<LecturerSession>(schema)
const validatePrepared = ajv.compile<PreparedCase>({ ...schema.$defs.prepared })
const validateCandidate = ajv.compile<Candidate>({ ...schema.$defs.candidate, $defs: schema.$defs })
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function same(a: unknown, b: unknown) { return canonicalJson(a) === canonicalJson(b) }
function checkItems(items: LecturerItem[], prepared: PreparedCase, candidates: Candidate[], complete: boolean) {
  requireThat(new Set(items.map(item => item.id)).size === items.length, 'Feedbackkennungen müssen eindeutig sein.')
  const ids = new Set(prepared.segments.map(segment => segment.segment_id))
  for (const item of items) {
    requireThat(item.evidence.every(id => ids.has(id)), 'Ein Beleg gehört nicht zur aktuellen Reflexion.')
    requireThat(!complete || item.text.trim(), 'Feedback darf bei der Freigabe nicht leer sein.')
    if (item.source) {
      const source = item.source
      requireThat(candidates.some(candidate => candidate.id === source.candidateId && candidate.items.some(original => original.id === source.itemId)), 'Unbekannte Feedbackherkunft.')
    }
  }
}
export function parsePrepared(value: unknown): PreparedCase {
  requireThat(validatePrepared(value), 'Ungültige synthetische Vorbereitung.')
  requireThat(new Set(value.segments.map(segment => segment.segment_id)).size === value.segments.length && value.segments.every((segment, index) => segment.order === index), 'Ungültige Segmentreihenfolge oder doppelte Kennung.')
  return structuredClone(value)
}
function checkCandidate(value: unknown, prepared: PreparedCase, condition: Condition): Candidate {
  requireThat(validateCandidate(value), 'Ungültiges Kandidatenergebnis.')
  requireThat(value.condition === condition && value.documentId === prepared.documentId && value.rubricId === prepared.rubric.id && value.rubricVersion === prepared.rubric.version, 'Das Ergebnis gehört nicht zur aktuellen Eingabe.')
  requireThat(value.items.every(item => item.source === null), 'Originale dürfen keine Entwurfsherkunft enthalten.')
  checkItems(value.items, prepared, [], true)
  return structuredClone(value)
}
export function bothSucceeded(session: LecturerSession): boolean {
  return CONDITIONS.every(condition => session.candidates[condition].status === 'succeeded')
}
function candidateIds(session: LecturerSession): string[] { return CONDITIONS.map(condition => session.candidates[condition].result!.id) }
export function parseLecturerSession(value: unknown, recover = true): LecturerSession {
  requireThat(validate(value), 'Ungültige oder nicht unterstützte Dozierenden-Sicherung (Version 1.0.0).')
  requireThat(new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength <= MAX_BACKUP_BYTES, 'Die Sitzung überschreitet das Sicherungslimit von 5 MB. Die Änderung wurde nicht übernommen.')
  const session = structuredClone(value)
  parsePrepared(session.prepared)
  for (const date of [session.confirmedAt, ...session.approvals.map(approval => approval.approvedAt)]) {
    requireThat(date === null || Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date, 'Ungültiger Zeitstempel.')
  }
  requireThat(!session.confirmedAt || DIMENSIONS.every(dimension => session.scores[dimension] !== null), 'Bestätigte Bewertungen müssen vollständig sein.')
  requireThat(CONDITIONS.filter(condition => session.candidates[condition].status === 'pending').length <= 1, 'Anfragen müssen nacheinander erfolgen.')
  for (const condition of CONDITIONS) {
    const attempt = session.candidates[condition]
    requireThat((attempt.status === 'succeeded') === Boolean(attempt.result), 'Ergebnis und Anfragestatus widersprechen sich.')
    requireThat(attempt.status === 'idle' ? attempt.attemptId === null && attempt.error === null : Boolean(session.confirmedAt && attempt.attemptId), 'Anfrage ohne bestätigte Bewertung oder Kennung.')
    requireThat(['failed', 'interrupted'].includes(attempt.status) ? Boolean(attempt.error) : attempt.error === null, 'Ungültiger Fehlerstatus.')
    if (attempt.result) checkCandidate(attempt.result, session.prepared, condition)
    if (recover && attempt.status === 'pending') {
      attempt.status = 'interrupted'
      attempt.error = 'Anfrage unterbrochen; Ergebnis unbekannt. Nur ausdrücklich erneut versuchen.'
    }
  }
  if (bothSucceeded(session)) requireThat(new Set(candidateIds(session)).size === 2, 'Kandidatenkennungen müssen verschieden sein.')
  requireThat(!session.comparison || bothSucceeded(session) && same(session.comparison.candidateIds, candidateIds(session)), 'Vergleich benötigt beide aktuellen Kandidaten.')
  const candidates = CONDITIONS.flatMap(condition => session.candidates[condition].result ?? [])
  if (session.draft) {
    requireThat(session.comparison && session.draft.comparisonRevision <= session.comparison.revision, 'Entwurf ohne gültigen Vergleich.')
    checkItems(session.draft.items, session.prepared, candidates, false)
  }
  for (const approval of session.approvals) {
    requireThat(session.draft && session.comparison && approval.draft.items.length && approval.draft.revision <= session.draft.revision
      && approval.comparisonRevision <= session.comparison.revision && approval.draft.comparisonRevision === approval.comparisonRevision
      && same(approval.candidateIds, candidateIds(session)), 'Ungültige Freigabebindung.')
    checkItems(approval.draft.items, session.prepared, candidates, true)
    if (approval.comparisonRevision === session.comparison.revision) requireThat(approval.preference === session.comparison.preference, 'Freigabe mit abweichender Präferenz.')
    if (approval.draft.revision === session.draft.revision) requireThat(same(approval.draft, session.draft), 'Freigabe und Entwurf mit gleicher Revision unterscheiden sich.')
  }
  return session
}
const idle = (): Attempt => ({ status: 'idle', attemptId: null, error: null, result: null })
export function createLecturerSession(prepared: unknown, id: string): LecturerSession {
  return parseLecturerSession({ kind: 'prebi_lecturer_workflow', schema_version: '1.0.0', id, revision: 0, prepared: parsePrepared(prepared), scores: { SW: null, UA: null, HA: null }, confirmedAt: null, candidates: { G1: idle(), G2: idle() }, comparison: null, draft: null, approvals: [] })
}
function change(session: LecturerSession, edit: (next: LecturerSession) => void): LecturerSession {
  const next = structuredClone(session)
  edit(next)
  next.revision++
  return parseLecturerSession(next, false)
}
export function setScore(session: LecturerSession, dimension: Dimension, score: number | null): LecturerSession {
  requireThat(!session.confirmedAt, 'Die Bewertung ist gesperrt. Öffnen Sie sie zuerst erneut.')
  return change(session, next => { next.scores[dimension] = score })
}
export function confirmScores(session: LecturerSession, now: string): LecturerSession {
  requireThat(!session.confirmedAt && DIMENSIONS.every(dimension => session.scores[dimension] !== null), 'Bestätigen Sie zunächst alle drei Bewertungen.')
  return change(session, next => { next.confirmedAt = now })
}
export function reopenScores(session: LecturerSession): LecturerSession {
  requireThat(session.confirmedAt, 'Die Bewertung ist noch nicht bestätigt.')
  return change(session, next => {
    next.confirmedAt = null
    next.candidates = { G1: idle(), G2: idle() }
    next.comparison = null
    next.draft = null
    next.approvals = []
  })
}
export function beginAttempt(session: LecturerSession, condition: Condition, attemptId: string): LecturerSession {
  requireThat(session.confirmedAt, 'Bewertungen müssen zuerst bestätigt werden.')
  requireThat(!CONDITIONS.some(key => session.candidates[key].status === 'pending'), 'Eine Anfrage läuft bereits.')
  requireThat(session.candidates[condition].status !== 'succeeded', 'Erfolgreiche Kandidaten werden nicht erneut erzeugt.')
  return change(session, next => { next.candidates[condition] = { status: 'pending', attemptId, error: null, result: null } })
}
export function finishAttempt(session: LecturerSession, sessionId: string, condition: Condition, attemptId: string, outcome: { result: unknown } | { error: string }): LecturerSession {
  const attempt = session.candidates[condition]
  if (session.id !== sessionId || attempt.status !== 'pending' || attempt.attemptId !== attemptId) return session
  return change(session, next => {
    next.candidates[condition] = 'result' in outcome
      ? { ...attempt, status: 'succeeded', result: checkCandidate(outcome.result, session.prepared, condition) }
      : { ...attempt, status: 'failed', error: outcome.error }
  })
}
export function choosePreference(session: LecturerSession, preference: Preference): LecturerSession {
  requireThat(bothSucceeded(session), 'Beide Kandidaten müssen erfolgreich vorliegen.')
  if (session.comparison?.preference === preference) return session
  return change(session, next => { next.comparison = { preference, revision: (next.comparison?.revision ?? 0) + 1, candidateIds: candidateIds(next) } })
}
export function startDraft(session: LecturerSession, source: Condition | 'blank', newId: () => string): LecturerSession {
  requireThat(session.comparison, 'Wählen Sie zuerst eine Präferenz.')
  return change(session, next => {
    const candidate = source === 'blank' ? null : next.candidates[source].result!
    next.draft = {
      revision: (next.draft?.revision ?? 0) + 1, comparisonRevision: next.comparison!.revision,
      items: candidate ? candidate.items.map(item => ({ ...structuredClone(item), id: newId(), source: { candidateId: candidate.id, itemId: item.id } })) : [],
    }
  })
}
export function editDraft(session: LecturerSession, items: LecturerItem[]): LecturerSession {
  requireThat(session.draft && session.comparison && session.draft.comparisonRevision === session.comparison.revision, 'Bestätigen Sie den Entwurf nach der Präferenzänderung erneut.')
  return change(session, next => { next.draft = { ...next.draft!, revision: next.draft!.revision + 1, items: structuredClone(items) } })
}
export function reconfirmDraft(session: LecturerSession): LecturerSession {
  requireThat(session.draft && session.comparison, 'Kein Entwurf zum Bestätigen.')
  return change(session, next => { next.draft = { ...next.draft!, revision: next.draft!.revision + 1, comparisonRevision: next.comparison!.revision } })
}
export function approvalCurrent(session: LecturerSession): boolean {
  const approval = session.approvals.at(-1)
  return Boolean(approval && session.comparison && approval.comparisonRevision === session.comparison.revision && same(approval.draft, session.draft))
}
export function approveDraft(session: LecturerSession, reviewed: boolean, now: string): LecturerSession {
  requireThat(reviewed && session.draft?.items.length && session.comparison && session.draft.comparisonRevision === session.comparison.revision, 'Prüfen und bestätigen Sie den aktuellen, nicht leeren Entwurf.')
  requireThat(!approvalCurrent(session), 'Dieser Entwurf ist bereits freigegeben.')
  checkItems(session.draft.items, session.prepared, CONDITIONS.map(condition => session.candidates[condition].result!), true)
  return change(session, next => { next.approvals.push({ draft: structuredClone(next.draft!), comparisonRevision: next.comparison!.revision, candidateIds: candidateIds(next), preference: next.comparison!.preference, approvedAt: now }) })
}
