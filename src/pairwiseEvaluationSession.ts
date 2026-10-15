import type { CaseResponse, PairKey, PairPreference, PairwiseEvaluationSession, PairwiseInputBundle, ReleaseChoice } from './pairwiseEvaluationTypes'
import { caseCompletion, isValidReferenceScore, pairCandidates, referenceScoresComplete, validateEvaluationBundle } from './pairwiseEvaluationValidation'

const pairKeys: PairKey[] = ['A-B', 'A-C', 'B-C']
const releaseChoices: ReleaseChoice[] = ['ready', 'edit', 'reject']
const preferences: PairPreference[] = ['first', 'second', 'tie']

function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Ungültiger Zeitstempel: ${field}.`)
  return value
}

function referenceDimensionIds(bundle: PairwiseInputBundle): string[] {
  return bundle.reference_scoring.dimensions.map(dimension => dimension.dimension_id)
}

function completionFor(bundle: PairwiseInputBundle, caseId: string, response: CaseResponse) {
  const evaluationCase = bundle.cases.find(item => item.case_id === caseId)
  if (!evaluationCase) throw new Error('Unbekannter Evaluationsfall.')
  return caseCompletion(response, evaluationCase.candidates.map(candidate => candidate.candidate_id), referenceDimensionIds(bundle))
}

export function emptyCaseResponse(): CaseResponse {
  return { reference_scores: {}, reference_comments: {}, release_readiness: {}, explanations: {}, pairwise_preferences: {} }
}

export function createEvaluationSession(bundle: PairwiseInputBundle, evaluatorId: string, bundleHash: string, now = new Date().toISOString()): PairwiseEvaluationSession {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(evaluatorId)) throw new Error('Die pseudonyme Bewertungs-ID muss 1–64 Zeichen ohne Leerzeichen enthalten.')
  if (!/^[a-f0-9]{64}$/i.test(bundleHash)) throw new Error('Die Integritätskennung des Evaluationspakets ist ungültig.')
  return {
    kind: 'prebi_pairwise_evaluation_session',
    schema_version: '1.2.0',
    protocol_id: bundle.protocol_id,
    protocol_version: bundle.protocol_version,
    evaluator_id: evaluatorId,
    input_bundle_sha256: bundleHash.toLowerCase(),
    input_bundle: bundle,
    responses: Object.fromEntries(bundle.cases.map(item => [item.case_id, emptyCaseResponse()])),
    active_case_index: 0,
    started_at: now,
    updated_at: now,
    completed_at: null,
  }
}

export function validateEvaluationSession(value: unknown): PairwiseEvaluationSession {
  const session = record(value, 'Ungültige Sitzungssicherung.')
  const expectedKeys = ['kind', 'schema_version', 'protocol_id', 'protocol_version', 'evaluator_id', 'input_bundle_sha256', 'input_bundle', 'responses', 'active_case_index', 'started_at', 'updated_at', 'completed_at']
  if (Object.keys(session).length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(session, key))) throw new Error('Die Sitzungssicherung enthält unbekannte oder fehlende Felder.')
  if (session.kind !== 'prebi_pairwise_evaluation_session' || session.schema_version !== '1.2.0' || session.protocol_id !== 'prebi_blinded_feedback_preference' || session.protocol_version !== '1.2.0') {
    throw new Error('Die Sitzungssicherung verwendet ein nicht unterstütztes Protokoll.')
  }
  if (typeof session.evaluator_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(session.evaluator_id)) throw new Error('Die Bewertungs-ID in der Sitzungssicherung ist ungültig.')
  if (typeof session.input_bundle_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(session.input_bundle_sha256)) throw new Error('Die Paket-Prüfsumme in der Sitzungssicherung ist ungültig.')
  const bundle = validateEvaluationBundle(session.input_bundle)
  if (session.protocol_id !== bundle.protocol_id || session.protocol_version !== bundle.protocol_version) throw new Error('Protokoll und Eingabepaket der Sitzung stimmen nicht überein.')
  if (!Number.isInteger(session.active_case_index) || Number(session.active_case_index) < 0 || Number(session.active_case_index) >= bundle.cases.length) throw new Error('Die aktive Fallposition der Sitzung ist ungültig.')
  timestamp(session.started_at, 'started_at')
  timestamp(session.updated_at, 'updated_at')
  if (session.completed_at !== null) timestamp(session.completed_at, 'completed_at')

  const casesById = new Map(bundle.cases.map(item => [item.case_id, item]))
  const rawResponses = record(session.responses, 'Die Antworten der Sitzung sind ungültig.')
  if (Object.keys(rawResponses).some(id => !casesById.has(id)) || bundle.cases.some(item => !Object.hasOwn(rawResponses, item.case_id))) throw new Error('Die Sitzung enthält unpassende Fallantworten.')
  const dimensionIds = referenceDimensionIds(bundle)
  const responses: Record<string, CaseResponse> = {}
  for (const [caseId, raw] of Object.entries(rawResponses)) {
    const answer = record(raw, `Antworten für Fall ${caseId} sind ungültig.`)
    const requiredAnswerKeys = ['reference_scores', 'reference_comments', 'release_readiness', 'explanations', 'pairwise_preferences']
    if (Object.keys(answer).some(key => ![...requiredAnswerKeys, 'reference_confirmed_at', 'completed_at'].includes(key))
      || requiredAnswerKeys.some(key => !Object.hasOwn(answer, key))) throw new Error(`Antworten für Fall ${caseId} enthalten unbekannte oder fehlende Felder.`)
    const evaluationCase = casesById.get(caseId)!
    const candidateIds = evaluationCase.candidates.map(candidate => candidate.candidate_id)
    const scores = record(answer.reference_scores, `Referenzbewertungen für Fall ${caseId} sind ungültig.`)
    const comments = record(answer.reference_comments, `Kommentare zur Referenzbewertung für Fall ${caseId} sind ungültig.`)
    if (Object.keys(scores).some(id => !dimensionIds.includes(id)) || Object.values(scores).some(score => !isValidReferenceScore(score))) throw new Error(`Referenzbewertung für Fall ${caseId} ist ungültig.`)
    if (Object.keys(comments).some(id => !dimensionIds.includes(id)) || Object.values(comments).some(text => typeof text !== 'string')) throw new Error(`Kommentar zur Referenzbewertung für Fall ${caseId} ist ungültig.`)
    const release = record(answer.release_readiness, `Freigabeentscheidungen für Fall ${caseId} sind ungültig.`)
    const explanations = record(answer.explanations, `Begründungen für Fall ${caseId} sind ungültig.`)
    const pairwise = record(answer.pairwise_preferences, `Paarvergleiche für Fall ${caseId} sind ungültig.`)
    if (Object.keys(release).some(id => !candidateIds.includes(id)) || Object.values(release).some(choice => !releaseChoices.includes(choice as ReleaseChoice))) throw new Error(`Freigabeentscheidung für Fall ${caseId} ist ungültig.`)
    if (Object.keys(explanations).some(id => !candidateIds.includes(id)) || Object.values(explanations).some(text => typeof text !== 'string')) throw new Error(`Begründung für Fall ${caseId} ist ungültig.`)
    if (Object.keys(pairwise).some(key => !pairKeys.includes(key as PairKey)) || Object.values(pairwise).some(preference => !preferences.includes(preference as PairPreference))) throw new Error(`Paarvergleich für Fall ${caseId} ist ungültig.`)
    for (const key of Object.keys(pairwise) as PairKey[]) {
      const [first, second] = pairCandidates(evaluationCase.display_order, key)
      if (!candidateIds.includes(first) || !candidateIds.includes(second)) throw new Error(`Kandidatenzuordnung für Fall ${caseId} ist ungültig.`)
    }
    const normalized: CaseResponse = {
      reference_scores: scores as CaseResponse['reference_scores'],
      reference_comments: comments as CaseResponse['reference_comments'],
      release_readiness: release as CaseResponse['release_readiness'],
      explanations: explanations as CaseResponse['explanations'],
      pairwise_preferences: pairwise as CaseResponse['pairwise_preferences'],
    }
    if (answer.reference_confirmed_at !== undefined) {
      normalized.reference_confirmed_at = timestamp(answer.reference_confirmed_at, 'reference_confirmed_at')
      if (!referenceScoresComplete(normalized, dimensionIds)) throw new Error(`Bestätigte Referenzbewertung für Fall ${caseId} ist unvollständig.`)
    } else if (Object.keys(release).length || Object.keys(explanations).length || Object.keys(pairwise).length) {
      throw new Error(`Feedbackentscheidungen für Fall ${caseId} liegen vor der bestätigten Referenzbewertung.`)
    }
    const completion = caseCompletion(normalized, candidateIds, dimensionIds)
    if (answer.completed_at !== undefined) normalized.completed_at = timestamp(answer.completed_at, 'case completed_at')
    if (completion.complete && !normalized.completed_at) throw new Error(`Vollständigem Fall ${caseId} fehlt der Abschlusszeitpunkt.`)
    if (!completion.complete && normalized.completed_at) throw new Error(`Unvollständiger Fall ${caseId} darf keinen Abschlusszeitpunkt enthalten.`)
    responses[caseId] = normalized
  }
  const allComplete = bundle.cases.every(item => completionFor(bundle, item.case_id, responses[item.case_id]).complete)
  if ((session.completed_at !== null) !== allComplete) throw new Error('Sitzungsabschluss und Fallantworten sind inkonsistent.')
  return { ...session, input_bundle: bundle, responses } as PairwiseEvaluationSession
}

function requireCase(session: PairwiseEvaluationSession, caseId: string) {
  const evaluationCase = session.input_bundle.cases.find(item => item.case_id === caseId)
  if (!evaluationCase) throw new Error('Unbekannter Evaluationsfall.')
  return evaluationCase
}

function requireReferenceDimension(session: PairwiseEvaluationSession, caseId: string, dimensionId: string) {
  requireCase(session, caseId)
  if (!referenceDimensionIds(session.input_bundle).includes(dimensionId)) throw new Error('Unbekannte Dimension der Referenzbewertung.')
  if (session.responses[caseId].reference_confirmed_at) throw new Error('Die Referenzbewertung dieser Reflexion ist bereits abgeschlossen und kann nicht mehr geändert werden.')
}

function requireConfirmedReference(session: PairwiseEvaluationSession, caseId: string) {
  if (!session.responses[caseId]?.reference_confirmed_at) throw new Error('Bitte schließen Sie zuerst die Referenzbewertung dieser Reflexion ab.')
}

export function setReferenceScore(session: PairwiseEvaluationSession, caseId: string, dimensionId: string, score: number | null, now = new Date().toISOString()): PairwiseEvaluationSession {
  requireReferenceDimension(session, caseId, dimensionId)
  if (score !== null && !isValidReferenceScore(score)) throw new Error('Geben Sie einen Wert von 0,0 bis 3,0 in Schritten von 0,5 ein.')
  const scores = { ...session.responses[caseId].reference_scores }
  if (score === null) delete scores[dimensionId]
  else scores[dimensionId] = score
  return withResponse(session, caseId, { ...session.responses[caseId], reference_scores: scores }, now)
}

export function setReferenceComment(session: PairwiseEvaluationSession, caseId: string, dimensionId: string, comment: string, now = new Date().toISOString()): PairwiseEvaluationSession {
  requireReferenceDimension(session, caseId, dimensionId)
  if (typeof comment !== 'string') throw new Error('Der Kommentar muss Text sein.')
  const comments = { ...session.responses[caseId].reference_comments }
  if (comment === '') delete comments[dimensionId]
  else comments[dimensionId] = comment
  return withResponse(session, caseId, { ...session.responses[caseId], reference_comments: comments }, now)
}

export function confirmReferenceScores(session: PairwiseEvaluationSession, caseId: string, now = new Date().toISOString()): PairwiseEvaluationSession {
  requireCase(session, caseId)
  const response = session.responses[caseId]
  if (response.reference_confirmed_at) return session
  if (!referenceScoresComplete(response, referenceDimensionIds(session.input_bundle))) throw new Error('Bitte vergeben Sie für alle drei Dimensionen einen gültigen Wert.')
  return withResponse(session, caseId, { ...response, reference_confirmed_at: now }, now)
}

export function setReleaseDecision(session: PairwiseEvaluationSession, caseId: string, candidateId: string, choice: ReleaseChoice, now = new Date().toISOString()): PairwiseEvaluationSession {
  const evaluationCase = session.input_bundle.cases.find(item => item.case_id === caseId)
  if (!evaluationCase || !evaluationCase.candidates.some(candidate => candidate.candidate_id === candidateId) || !releaseChoices.includes(choice)) throw new Error('Unbekannter Fall, Feedbackkandidat oder ungültige Freigabeentscheidung.')
  requireConfirmedReference(session, caseId)
  const response = session.responses[caseId]
  const updated: CaseResponse = { ...response, release_readiness: { ...response.release_readiness, [candidateId]: choice } }
  return withResponse(session, caseId, updated, now)
}

export function setExplanation(session: PairwiseEvaluationSession, caseId: string, candidateId: string, explanation: string, now = new Date().toISOString()): PairwiseEvaluationSession {
  const evaluationCase = session.input_bundle.cases.find(item => item.case_id === caseId)
  if (!evaluationCase || !evaluationCase.candidates.some(candidate => candidate.candidate_id === candidateId)) throw new Error('Unbekannter Fall oder Feedbackkandidat.')
  if (typeof explanation !== 'string') throw new Error('Die Begründung muss Text sein.')
  requireConfirmedReference(session, caseId)
  return withResponse(session, caseId, { ...session.responses[caseId], explanations: { ...session.responses[caseId].explanations, [candidateId]: explanation } }, now)
}

export function setPairPreference(session: PairwiseEvaluationSession, caseId: string, pair: PairKey, preference: PairPreference, now = new Date().toISOString()): PairwiseEvaluationSession {
  const evaluationCase = session.input_bundle.cases.find(item => item.case_id === caseId)
  if (!evaluationCase || !pairKeys.includes(pair) || !preferences.includes(preference)) throw new Error('Unbekannter Fall oder ungültige Paarentscheidung.')
  requireConfirmedReference(session, caseId)
  return withResponse(session, caseId, { ...session.responses[caseId], pairwise_preferences: { ...session.responses[caseId].pairwise_preferences, [pair]: preference } }, now)
}

function withResponse(session: PairwiseEvaluationSession, caseId: string, response: CaseResponse, now: string): PairwiseEvaluationSession {
  const complete = completionFor(session.input_bundle, caseId, response).complete
  const previousCompletedAt = session.responses[caseId].completed_at
  const normalized: CaseResponse = { ...response, ...(complete ? { completed_at: previousCompletedAt ?? now } : {}) }
  if (!complete) delete normalized.completed_at
  const responses = { ...session.responses, [caseId]: normalized }
  const allComplete = session.input_bundle.cases.every(item => completionFor(session.input_bundle, item.case_id, responses[item.case_id]).complete)
  return { ...session, responses, updated_at: now, completed_at: allComplete ? session.completed_at ?? now : null }
}

export function researchExport(session: PairwiseEvaluationSession) {
  const completedCases = session.input_bundle.cases.flatMap(evaluationCase => {
    const response = session.responses[evaluationCase.case_id]
    if (!completionFor(session.input_bundle, evaluationCase.case_id, response).complete) return []
    const preferenceRecords = pairKeys.map(key => {
      const [candidate1, candidate2] = pairCandidates(evaluationCase.display_order, key)
      const preference = response.pairwise_preferences[key]!
      return {
        candidate_1: candidate1,
        candidate_2: candidate2,
        preference,
        preferred_candidate_id: preference === 'tie' ? null : preference === 'first' ? candidate1 : candidate2,
      }
    })
    return [{
      case_id: evaluationCase.case_id,
      reflection_id: evaluationCase.reflection_id,
      display_order: { ...evaluationCase.display_order },
      reference_scores: Object.fromEntries(referenceDimensionIds(session.input_bundle).map(id => [id, {
        score: response.reference_scores[id]!,
        ...(response.reference_comments[id]?.trim() ? { comment: response.reference_comments[id] } : {}),
      }])),
      reference_confirmed_at: response.reference_confirmed_at!,
      release_readiness: { ...response.release_readiness },
      ...(Object.keys(response.explanations).length ? { explanations: { ...response.explanations } } : {}),
      pairwise_preferences: preferenceRecords,
      completed_at: response.completed_at!,
    }]
  })
  return {
    schema_version: '1.2.0',
    protocol_id: session.protocol_id,
    protocol_version: session.protocol_version,
    reference_score_protocol: {
      protocol_id: session.input_bundle.reference_scoring.protocol_id,
      protocol_version: session.input_bundle.reference_scoring.protocol_version,
      rubric_version: session.input_bundle.reference_scoring.rubric_version,
    },
    evaluator_id: session.evaluator_id,
    input_bundle_sha256: session.input_bundle_sha256,
    completion_status: session.completed_at ? 'complete' : 'in_progress',
    started_at: session.started_at,
    updated_at: session.updated_at,
    completed_at: session.completed_at,
    completed_case_count: completedCases.length,
    total_case_count: session.input_bundle.cases.length,
    cases: completedCases,
  }
}
