import Ajv from 'ajv'
import type { Segment } from './ratingTypes'

export type G1Document = { document_id: string; segments: Segment[] }
type Dimension = 'SW' | 'UA' | 'HA'
type Claim = { interpretation: string; evidence_refs: string[] }
type Point = { message: string; evidence_segment_ids: string[] }
export type G1Output = {
  evidence_synthesis: { dimension_id: Dimension; demonstrated_depth: Claim[]; development: Claim[]; integrative_coherence: Claim[]; limitations: Claim[]; uncertainty: Claim[] }[]
  assessment: { component_assessments: { dimension_id: Dimension; band: number; justification: string; evidence_segment_ids: string[]; intermediate_score_explanation: string | null }[] }
  feedback: { strengths: Point[]; weaknesses: Point[]; suggestions: Point[] }
}
export type G1Result = { output: G1Output; raw: string; document: G1Document }

const object = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const text = { type: 'string', minLength: 1 }
const references = { type: 'array', items: { type: 'string' } }
const claim = object({ interpretation: text, evidence_refs: { ...references, minItems: 1 } })
const claims = (minItems = 0) => ({ type: 'array', items: claim, minItems })
const dimension = { enum: ['SW', 'UA', 'HA'] }
const outputSchema = object({
  evidence_synthesis: { type: 'array', minItems: 3, maxItems: 3, items: object({
    dimension_id: dimension, demonstrated_depth: claims(1), development: claims(1), integrative_coherence: claims(1), limitations: claims(), uncertainty: claims(),
  }) },
  assessment: object({ component_assessments: { type: 'array', minItems: 3, maxItems: 3, items: object({
    dimension_id: dimension, band: { enum: [0, 0.5, 1, 1.5, 2, 2.5, 3] }, justification: text,
    evidence_segment_ids: { ...references, minItems: 1 }, intermediate_score_explanation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  }) } }),
  feedback: object(Object.fromEntries(['strengths', 'weaknesses', 'suggestions'].map(key => [key, { type: 'array', items: object({ message: text, evidence_segment_ids: references }) }]))),
})
const validate = new Ajv().compile<G1Output>(outputSchema)

const abbreviationAtEnd = /(?:^|[^\p{L}])(?:z\.\s*b|d\.\s*h|u\.\s*a|o\.\s*ä|u\.\s*v\.\s*m|bzw|usw|etc|vgl|ca|dr|prof|hr|nr|s|z|d|u|o)\.$/iu

export function splitReflectionSegments(textValue: string): string[] {
  const segments: string[] = []
  const boundary = /\.[ \t]*(?:\r\n|\r|\n)[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)*/g
  let start = 0
  for (const match of textValue.matchAll(boundary)) {
    const end = match.index + 1
    const current = textValue.slice(start, end)
    const remaining = textValue.slice(match.index + match[0].length)
    if (abbreviationAtEnd.test(current) || (/\d\.$/.test(current) && /^\d/.test(remaining))) continue
    const segment = current.trim()
    if (segment) segments.push(segment)
    start = match.index + match[0].length
  }
  const last = textValue.slice(start).trim()
  if (last) segments.push(last)
  return segments
}

export function makeG1Document(segments: string[], documentId: string): G1Document {
  if (!documentId.trim() || !segments.length || segments.some(segment => !segment.trim())) throw new Error('Die Reflexion muss mindestens ein nicht leeres Segment enthalten.')
  return { document_id: documentId, segments: segments.map((text, order) => ({ segment_id: `s${order + 1}`, text, order })) }
}

export function validateG1Output(value: unknown, document: G1Document): G1Output {
  if (!validate(value)) throw new Error('Die G1-Antwort entspricht nicht dem erwarteten Schema.')
  const dimensionSet = (items: { dimension_id: Dimension }[]) => new Set(items.map(item => item.dimension_id)).size === 3
  const ids = new Set(document.segments.map(segment => segment.segment_id))
  const validReferences = (refs: string[]) => refs.every(id => ids.has(id))
  if (!dimensionSet(value.evidence_synthesis) || !dimensionSet(value.assessment.component_assessments)
    || value.evidence_synthesis.some(item => [item.demonstrated_depth, item.development, item.integrative_coherence, item.limitations, item.uncertainty].some(group => group.some(entry => !validReferences(entry.evidence_refs))))
    || value.assessment.component_assessments.some(item => !validReferences(item.evidence_segment_ids) || ([0.5, 1.5, 2.5].includes(item.band) && !item.intermediate_score_explanation?.trim()))
    || Object.values(value.feedback).some(group => group.some(entry => !validReferences(entry.evidence_segment_ids)))) {
    throw new Error('Die G1-Antwort enthält ungültige Dimensionen, Belege oder Zwischenwertbegründungen.')
  }
  return value
}

export async function generateG1(document: G1Document, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<G1Result> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 120_000)
  const networkError = 'Verbindung unterbrochen oder Zeitlimit überschritten; das Ergebnis ist unbekannt. Eine Anfrage kann bereits verarbeitet worden sein. Keine automatische Wiederholung.'
  try {
    let response: Response
    try {
      response = await fetcher('/api/g1/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document), cache: 'no-store', redirect: 'error', signal: controller.signal })
    } catch { throw new Error(networkError) }
    if (!response.ok) {
      const messages: Record<number, string> = { 422: 'Die G1-Eingabe wurde vom Dienst abgelehnt.', 502: 'Die G1-Erzeugung oder die Validierung des Modellergebnisses ist fehlgeschlagen.', 503: 'Der G1-Dienst ist nicht bereit. Prüfen Sie Konfiguration, Zugangsdaten und Dienstprotokoll.' }
      throw new Error(messages[response.status] ?? `Die G1-Anfrage ist fehlgeschlagen (HTTP ${response.status}).`)
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw new Error('Die G1-API liefert keine JSON-Antwort.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    let size = 0
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try { chunk = await reader.read() } catch { throw new Error(networkError) }
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 5_000_000) { controller.abort(); throw new Error('Die G1-Antwort überschreitet das Limit von 5 MB.') }
        raw += decoder.decode(chunk.value, { stream: true })
      }
      raw += decoder.decode()
    } finally { reader.releaseLock() }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('Die G1-API liefert ungültiges JSON.') }
    return { output: validateG1Output(parsed, document), raw, document }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
