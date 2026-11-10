import Ajv from 'ajv'
import type { Candidate, Condition, PreparedCase } from './lecturerSession'
import type { LecturerService } from './lecturerService'

const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const text = { type: 'string', minLength: 1, maxLength: 20000 }
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9._:-]+$' }
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' }
const list = (items: object, minItems = 0) => ({ type: 'array', items, minItems, maxItems: 500 })
const dimensions = ['SW', 'UA', 'HA'] as const
const dimension = { enum: dimensions }
const references = { ...list(id), uniqueItems: true }
const point = object({ message: text, evidence_segment_ids: references })
const claim = object({ interpretation: text, evidence_refs: { ...references, minItems: 1 } })
const scores = { enum: [0, 0.5, 1, 1.5, 2, 2.5, 3] }
export const preparationSchema = object({
  document: object({ document_id: id, segments: list(object({ segment_id: id, text, order: { type: 'integer', minimum: 0 } }), 1) }),
  analysis: object({
    source: { const: 'predicted' },
    segments: list(object({
      segment_id: id, scope: { enum: ['in_scope', 'out_of_scope'] },
      component_bands: object(Object.fromEntries(dimensions.map(key => [key, { enum: ['N', '0', '1', '2', '3'] }]))),
    }), 1),
    summary: { anyOf: [{ type: 'array', maxItems: 3, items: { type: 'object' } }, { type: 'null' }] },
  }, ['source', 'segments']),
  segment_locations: list(object({ segment_id: id, page_number: { type: 'integer', minimum: 1 }, start_char: { type: 'integer', minimum: 0 }, end_char: { type: 'integer', minimum: 0 } })),
})
export const materialsSchema = object({
  generation_rubric: object({
    artifact_id: id, version: id, sha256: hash,
    content: {
      type: 'object', required: ['rubric_id', 'version', 'dimensions', 'glossary'],
      properties: { rubric_id: id, version: id, glossary: { type: 'object', additionalProperties: text }, dimensions: list(object({ dimension_id: dimension, name: text, description: text, bands: object({ '0': text, '1': text, '2': text, '3': text }) }), 3) },
    },
  }),
  scoring_guide: object({
    artifact_id: id, version: id, sha256: hash,
    content: {
      type: 'object', required: ['guide_id', 'version', 'status', 'scale', 'dimensions', 'scoring_principles', 'intermediate_score_guidance', 'generation_rubric'],
      properties: {
        guide_id: id, version: id, status: { const: 'approved' },
        scale: { type: 'object', required: ['allowed_scores'], properties: { allowed_scores: { const: [0, 0.5, 1, 1.5, 2, 2.5, 3] } } },
        dimensions: list(object({ dimension_id: dimension, name: text, focus: text, anchors: object({ '0': text, '1': text, '2': text, '3': text }) }), 3),
        scoring_principles: list(text, 1),
        intermediate_score_guidance: object({ '0.5': text, '1.5': text, '2.5': text, required_justification: text }),
        generation_rubric: object({ rubric_id: id, version: id, relationship: text }),
      },
    },
  }),
  relationship: text,
})
export const generationSchema = object({
  generation_id: id, condition: { enum: ['G1', 'G2'] }, document_id: id, feedback_letter: text,
  provenance: object({ model_name: text, pipeline_version: id, prompt_version: id, rubric_id: id, rubric_version: id, rubric_sha256: hash }),
  output: object({
    feedback: object({ strengths: list(point), weaknesses: list(point), suggestions: list(point) }),
    assessment: object({ component_assessments: list(object({
      dimension_id: dimension, band: scores, justification: text, evidence_segment_ids: { ...references, minItems: 1 },
      intermediate_score_explanation: { anyOf: [text, { type: 'null' }] },
    }), 3) }),
    evidence_synthesis: list(object({
      dimension_id: dimension, demonstrated_depth: list(claim, 1), development: list(claim, 1),
      integrative_coherence: list(claim, 1), limitations: list(claim), uncertainty: list(claim),
    }), 3),
  }),
})

type Dimension = typeof dimensions[number]
export type ApiPreparation = {
  document: { document_id: string; segments: { segment_id: string; text: string; order: number }[] }
  analysis: { source: 'predicted'; segments: { segment_id: string; scope: 'in_scope' | 'out_of_scope'; component_bands: Record<Dimension, 'N' | '0' | '1' | '2' | '3'> }[]; summary?: unknown }
  segment_locations: { segment_id: string; page_number: number; start_char: number; end_char: number }[]
}
type GuideContent = {
  guide_id: string; version: string; status: 'approved'
  scale: { allowed_scores: number[] }
  dimensions: { dimension_id: Dimension; name: string; focus: string; anchors: Record<string, string> }[]
  scoring_principles: string[]
  intermediate_score_guidance: Record<string, string>
  generation_rubric: { rubric_id: string; version: string; relationship: string }
}
export type ApiMaterials = {
  generation_rubric: { artifact_id: string; version: string; sha256: string; content: { rubric_id: string; version: string; dimensions: { dimension_id: Dimension }[] } }
  scoring_guide: { artifact_id: string; version: string; sha256: string; content: GuideContent }
  relationship: string
}
type Claim = { interpretation: string; evidence_refs: string[] }
export type ApiGeneration = {
  generation_id: string; condition: Condition; document_id: string; feedback_letter: string
  provenance: { model_name: string; pipeline_version: string; prompt_version: string; rubric_id: string; rubric_version: string; rubric_sha256: string }
  output: {
    feedback: Record<'strengths' | 'weaknesses' | 'suggestions', { message: string; evidence_segment_ids: string[] }[]>
    assessment: { component_assessments: { dimension_id: Dimension; band: number; justification: string; evidence_segment_ids: string[]; intermediate_score_explanation: string | null }[] }
    evidence_synthesis: { dimension_id: Dimension; demonstrated_depth: Claim[]; development: Claim[]; integrative_coherence: Claim[]; limitations: Claim[]; uncertainty: Claim[] }[]
  }
}
const ajv = new Ajv({ allErrors: true })
const validPreparation = ajv.compile<ApiPreparation>(preparationSchema)
const validMaterials = ajv.compile<ApiMaterials>(materialsSchema)
const validGeneration = ajv.compile<ApiGeneration>(generationSchema)
function requireValid(value: unknown, message = 'Ungültige oder nicht passende API-Antwort.'): asserts value {
  if (!value) throw new Error(message)
}
function checkDimensions(values: { dimension_id: string }[]) {
  requireValid(values.length === 3 && new Set(values.map(value => value.dimension_id)).size === 3)
}
export function validateApiPrepared(preparation: unknown, materials: unknown): asserts preparation is ApiPreparation {
  requireValid(validPreparation(preparation) && validMaterials(materials))
  const rubric = materials.generation_rubric
  const guide = materials.scoring_guide
  requireValid(rubric.artifact_id === rubric.content.rubric_id && rubric.version === rubric.content.version
    && guide.artifact_id === guide.content.guide_id && guide.version === guide.content.version
    && guide.content.generation_rubric.rubric_id === rubric.artifact_id && guide.content.generation_rubric.version === rubric.version)
  checkDimensions(rubric.content.dimensions)
  checkDimensions(guide.content.dimensions)
  const segments = preparation.document.segments
  const ids = new Set(segments.map(segment => segment.segment_id))
  requireValid(ids.size === segments.length && segments.every((segment, index) => index === 0 || segment.order > segments[index - 1].order))
  const analysis = preparation.analysis.segments
  requireValid(analysis.length === ids.size && new Set(analysis.map(segment => segment.segment_id)).size === ids.size)
  for (const segment of analysis) {
    requireValid(ids.has(segment.segment_id) && Object.values(segment.component_bands).every(band => segment.scope === 'out_of_scope' ? band === 'N' : band !== 'N'))
  }
  requireValid(preparation.segment_locations.length === ids.size && new Set(preparation.segment_locations.map(location => location.segment_id)).size === ids.size)
  for (const location of preparation.segment_locations) requireValid(ids.has(location.segment_id) && location.end_char >= location.start_char)
}
export function mapApiPrepared(preparation: unknown, materials: unknown): PreparedCase {
  validateApiPrepared(preparation, materials)
  requireValid(validMaterials(materials))
  const guide = materials.scoring_guide.content
  const guidance = [
    ...guide.scoring_principles,
    ...guide.dimensions.map(value => `${value.dimension_id} – ${value.name}: ${value.focus}\n${Object.entries(value.anchors).map(([score, anchor]) => `${score}: ${anchor}`).join('\n')}`),
    ...Object.entries(guide.intermediate_score_guidance).map(([score, guidance]) => `${score}: ${guidance}`),
  ].join('\n\n')
  const rubric = materials.generation_rubric
  return {
    documentId: preparation.document.document_id, provenance: 'http-api-v1',
    rubric: { id: rubric.artifact_id, version: rubric.version, guidance },
    segments: preparation.document.segments.map(segment => {
      const prediction = preparation.analysis.segments.find(value => value.segment_id === segment.segment_id)!
      const band = (key: Dimension) => prediction.component_bands[key] === 'N' ? null : Number(prediction.component_bands[key])
      return { ...segment, prediction: { SW: band('SW'), UA: band('UA'), HA: band('HA') } }
    }),
    api: { preparation: structuredClone(preparation), materials: structuredClone(materials) },
  }
}
export function mapApiGeneration(value: unknown, prepared: PreparedCase, condition: Condition): Candidate {
  requireValid(prepared.api && validGeneration(value))
  const rubric = prepared.api.materials.generation_rubric
  requireValid(value.condition === condition && value.document_id === prepared.documentId
    && value.provenance.rubric_id === rubric.artifact_id && value.provenance.rubric_version === rubric.version && value.provenance.rubric_sha256 === rubric.sha256)
  checkDimensions(value.output.assessment.component_assessments)
  checkDimensions(value.output.evidence_synthesis)
  const ids = new Set(prepared.segments.map(segment => segment.segment_id))
  const checkRefs = (refs: string[]) => requireValid(new Set(refs).size === refs.length && refs.every(id => ids.has(id)))
  for (const assessment of value.output.assessment.component_assessments) {
    checkRefs(assessment.evidence_segment_ids)
    requireValid(Number.isInteger(assessment.band) || assessment.intermediate_score_explanation?.trim())
  }
  for (const synthesis of value.output.evidence_synthesis) {
    for (const key of ['demonstrated_depth', 'development', 'integrative_coherence', 'limitations', 'uncertainty'] as const) {
      for (const claim of synthesis[key]) checkRefs(claim.evidence_refs)
    }
  }
  const items = (['strengths', 'weaknesses', 'suggestions'] as const).flatMap(category => value.output.feedback[category].map((point, index) => {
    checkRefs(point.evidence_segment_ids)
    return { id: `${condition}-${category}-${index}`, category, text: point.message, evidence: point.evidence_segment_ids, source: null }
  }))
  return { id: value.generation_id, condition, documentId: value.document_id, rubricId: rubric.artifact_id, rubricVersion: rubric.version, provenance: 'http-api-v1', items, api: structuredClone(value) }
}

export function createHttpLecturerService(fetcher: typeof fetch = fetch): LecturerService {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    const networkMessage = 'Verbindung unterbrochen oder Zeitlimit überschritten; Ergebnis unbekannt. Keine automatische Wiederholung. Eine Erzeugung kann bereits verarbeitet worden sein.'
    try {
      let response: Response
      try { response = await fetcher(`/api/v1/${path}`, { ...init, cache: 'no-store', redirect: 'error', signal: controller.signal }) }
      catch { throw new Error(networkMessage) }
      if (!response.ok) {
        const messages: Record<number, string> = { 403: 'Externe Erzeugung ist serverseitig nicht autorisiert.', 409: 'Bewertungsmaterial geändert. Bereiten Sie den Fall mit aktuellen Materialien neu vor.', 413: 'Die PDF überschreitet das Limit von 10 MiB.', 422: 'Die Eingabe wurde abgelehnt. Prüfen Sie Datei und Eingabedaten.', 502: 'Erzeugung fehlgeschlagen; kein Ergebnis angenommen.', 503: 'Dienst ist derzeit nicht verfügbar.', 504: 'Zeitlimit überschritten; Ergebnis unbekannt. Nur ausdrücklich erneut versuchen.' }
        controller.abort()
        throw new Error(messages[response.status] ?? 'API-Anfrage fehlgeschlagen. Ihr bisheriger Stand bleibt erhalten.')
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        controller.abort()
        throw new Error('Die API liefert kein JSON.')
      }
      const reader = response.body?.getReader()
      requireValid(reader, 'Die API liefert keine Antwortdaten.')
      const decoder = new TextDecoder()
      let raw = ''
      let bytes = 0
      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>
          try { chunk = await reader.read() }
          catch { throw new Error(networkMessage) }
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 5_000_000) {
            controller.abort()
            throw new Error('API-Antwort überschreitet das Limit von 5 MB.')
          }
          raw += decoder.decode(chunk.value, { stream: true })
        }
        raw += decoder.decode()
      } finally { reader.releaseLock() }
      try { return JSON.parse(raw) }
      catch { throw new Error('Die API liefert ungültiges JSON.') }
    } finally { clearTimeout(timer) }
  }
  return {
    async prepare(file?: File) {
      requireValid(file && file.size > 0 && file.size <= 10 * 1024 * 1024, 'Wählen Sie eine nicht leere PDF bis 10 MiB.')
      const materials = await request('rating-materials')
      requireValid(validMaterials(materials), 'Ungültige Bewertungsmaterialien.')
      const body = new FormData()
      body.append('file', file)
      return mapApiPrepared(await request('preparations', { method: 'POST', body }), materials)
    },
    async generate(prepared, condition, _attemptId, allowExternalGeneration = false) {
      requireValid(prepared.api && allowExternalGeneration, 'Bestätigen Sie ausdrücklich die autorisierte externe Erzeugung.')
      const rubric = prepared.api.materials.generation_rubric
      return mapApiGeneration(await request('generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition, document: prepared.api.preparation.document,
          expected_rubric: { rubric_id: rubric.artifact_id, version: rubric.version, sha256: rubric.sha256 },
          ...(condition === 'G2' ? { analysis: { source: 'predicted', segments: prepared.api.preparation.analysis.segments } } : {}),
          allow_external_generation: true,
        }),
      }), prepared, condition)
    },
  }
}
