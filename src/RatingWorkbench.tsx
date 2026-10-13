import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  ShieldCheck,
} from 'lucide-react'
import { AppShell, PacketFileButton } from './AppShell'
import './RatingWorkbench.css'
import SourceComparison from './SourceComparison'
import ConsensusControls from './ConsensusControls'
import FeedbackComparisonControls from './FeedbackComparisonControls'
import { componentLabels, type ConsensusCaseState, type Draft, type Packet, type RatingTask, type ScoreAnswer, type SpanComment } from './ratingTypes'
import { answerError, canonicalJson, emptyDraft, evaluationSteps, isValidReferenceScore, parseReferenceScoreInput, referenceAnchorScores, REFERENCE_SCORE_SCALE, responseForDraft, type CaseState } from './ratingValidation'
import RatingProgress from './RatingProgress'
import PacketNavigator from './PacketNavigator'
import { readSession, writeSession, listSessions } from './localSessions'
import { WorkflowHelp, ResumePrompt, ExportSummary, PersistenceStatus } from './WorkflowSupport'
import { assessmentReferenceState, assertConsensusBlinding, assertSourcesMatch, bundleHash, captureAssessmentReference, captureC1Snapshot, checkPacketHashes, consensusAnswerErrors, consensusCaseState, consensusResearchExport, draftFromResponse, emptyAssessmentReferences, emptyC1Snapshots, emptyConsensus, emptyFeedbackComparison, ensureFeedbackComparisonCase, enterFeedbackComparison, expertCaseState, feedbackC1GateReady, finalizeFeedbackComparison, finalizedAssessmentReference, finalizeConsensus, flagConsensus, historicalFeedbackVisible, latestC1Snapshot, legacyDraft, reopenConsensus, reopenFeedbackComparison, researchExportPackets, resumeConsensus, sessionKey, validateDraft, validatePackets, validateSession, type ExpertSession, type PendingEditor } from './expertSession'
type SavedRating = {
  schema_version: '1.0.0' | '1.1.0'
  rating_id: string
  packet_id: string
  task: RatingTask
  evaluator_type: 'human'
  evaluator_id: string
  protocol_id: string
  protocol_version: string
  scoring_scale_id?: string
  packet_version: string
  display_output_sha256?: string
  displayed_reflection_sha256?: string
  submitted_at: string
  response: unknown
  evaluation_mode?: 'expert_consensus'
  panel_id?: string
  panel_members?: string[]
  consensus?: NonNullable<ExpertSession['consensus']>[string]
}

const TASK_LABELS: Record<RatingTask, string> = {
  reflection_reference_score: 'Referenzbewertung der Reflexion',
  assessment_quality: 'Qualität der Einschätzung',
  feedback_quality: 'Feedbackqualität',
  feedback_implied_score: 'Aus Feedback abgeleiteter Punktwert',
}
const STORAGE_KEY = 'prebi-rating-workbench-v1'
const TAGS = ['unsupported', 'inaccurate', 'vague', 'actionable', 'strength', 'concern', 'other']
const TAG_LABELS: Record<string, string> = { unsupported: 'Nicht belegt', inaccurate: 'Unzutreffend', vague: 'Unklar', actionable: 'Handlungsorientiert', strength: 'Stärke', concern: 'Bedenken', other: 'Sonstiges' }

function queueKey(packet: Packet, evaluatorId: string) {
  return `${evaluatorId.trim()}::${packet.packet_id}`
}

function availableTasks(packets: Packet[], consensusMode = false): RatingTask[] {
  return (Object.keys(TASK_LABELS) as RatingTask[]).filter(task => packets.some(packet => packet.task === task) && (!consensusMode || task !== 'feedback_implied_score'))
}

function firstTask(packets: Packet[], consensusMode = false): RatingTask {
  return availableTasks(packets, consensusMode)[0] ?? packets[0].task
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function legacyObject(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function legacyRatings(): Record<string, SavedRating> {
  return Object.fromEntries(Object.entries(legacyObject(`${STORAGE_KEY}-submitted`)).filter(([, value]) => {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<SavedRating>
    return record.schema_version === '1.0.0' && record.evaluator_type === 'human'
      && ['rating_id', 'packet_id', 'evaluator_id', 'protocol_id', 'protocol_version', 'packet_version', 'submitted_at'].every(field => typeof record[field as keyof SavedRating] === 'string')
      && Object.hasOwn(TASK_LABELS, record.task ?? '') && record.response !== undefined
  })) as Record<string, SavedRating>
}

function checkLegacySources(packets: Packet[]) {
  for (const record of Object.values(legacyRatings())) {
    const packet = packets.find(item => item.packet_id === record.packet_id)
    if (!packet) continue
    if (record.task !== packet.task || record.protocol_id !== packet.protocol_id || record.protocol_version !== packet.protocol_version || record.packet_version !== packet.packet_version
      || (record.display_output_sha256 !== undefined && record.display_output_sha256 !== packet.display_output_sha256)
      || (record.displayed_reflection_sha256 !== undefined && record.displayed_reflection_sha256 !== packet.displayed_reflection_sha256)) throw new Error(`Fall-ID ${packet.packet_id} widerspricht einer älteren gespeicherten Bewertung.`)
  }
}

function freshSession(session: ExpertSession): ExpertSession {
  return { ...session, drafts: Object.fromEntries(session.packets.map(packet => [packet.packet_id, emptyDraft(packet)])), pending_editors: {}, ...(session.evaluation_mode === 'expert_consensus' ? { consensus: emptyConsensus(session.packets), schema_version: '1.2.0' as const, assessment_reference_snapshots: emptyAssessmentReferences(session.packets), c1_snapshots: emptyC1Snapshots(session.packets), feedback_comparison: emptyFeedbackComparison() } : {}), active_task: firstTask(session.packets, session.evaluation_mode === 'expert_consensus'), active_index: 0, active_criterion: 0 }
}

type PendingSession = {
  incoming: ExpertSession
  saved: ExpertSession
  fingerprint: string | undefined
  conflict: boolean
}

export default function RatingWorkbench() {
  const [session, setSession] = useState<ExpertSession | null>(null)
  const [evaluationMode, setEvaluationMode] = useState<'individual' | 'expert_consensus'>('individual')
  const [evaluatorId, setEvaluatorId] = useState(() => {
    try { return localStorage.getItem('prebi-rating-evaluator') ?? '' } catch { return '' }
  })
  const [panelId, setPanelId] = useState(() => {
    try { return localStorage.getItem('prebi-rating-panel') ?? '' } catch { return '' }
  })
  const [savedSessions, setSavedSessions] = useState<ExpertSession[]>([])
  const [pending, setPending] = useState<PendingSession | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [error, setError] = useState('')
  const [persistence, setPersistence] = useState<'saving' | 'saved' | 'error' | 'idle'>('idle')
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [selectedSpan, setSelectedSpan] = useState<PendingEditor['selection']>(null)
  const [spanComment, setSpanComment] = useState('')
  const [spanTags, setSpanTags] = useState<string[]>([])
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const expectedFingerprint = useRef<string | undefined>(undefined)
  const autosaveBaseline = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const currentSession = useRef(session)
  currentSession.current = session
  const packets = session?.packets ?? []
  const consensusMode = session?.evaluation_mode === 'expert_consensus'
  const taskFilter = session?.active_task ?? 'feedback_implied_score'
  const packetIndex = session?.active_index ?? 0
  const criterionIndex = session?.active_criterion ?? 0
  const taskPackets = packets.filter(packet => packet.task === taskFilter && (!consensusMode || packet.task !== 'feedback_implied_score'))
  const packet = taskPackets[packetIndex] ?? null
  const draft = packet ? session!.drafts[packet.packet_id] : null
  const packetState = (item: Packet): CaseState => session ? expertCaseState(item, session) : 'not_started'
  const packetStates: CaseState[] = taskPackets.map(packetState)
  const consensusStates: ConsensusCaseState[] = session && consensusMode ? taskPackets.map(item => consensusCaseState(item, session)) : []
  const doneCount = consensusMode ? consensusStates.filter(state => state === 'finalized').length : packetStates.filter(state => state === 'complete').length
  const exportPackets = session ? researchExportPackets(session) : []
  const completeCount = exportPackets.length
  const feedbackC1Ready = Boolean(session && consensusMode && feedbackC1GateReady(session))
  const feedbackC2Active = Boolean(session && historicalFeedbackVisible(session))
  const startedCount = session ? packets.filter(item => consensusMode
    ? item.task !== 'feedback_implied_score' && consensusCaseState(item, session) !== 'not_started'
    : packetState(item) !== 'not_started').length : 0
  const steps = packet ? evaluationSteps(packet) : []
  const consensusRecord = packet && consensusMode ? session?.consensus?.[packet.packet_id] : undefined
  const consensusStatus = packet && session && consensusMode ? consensusCaseState(packet, session) : 'not_started'
  const consensusFinalized = consensusRecord?.status === 'finalized'
  const identity = evaluationMode === 'expert_consensus' ? panelId.trim() : evaluatorId.trim()
  const savedForEvaluator = Object.values(legacyRatings()).filter(rating => rating.evaluator_id === identity)

  useEffect(() => {
    try { localStorage.setItem('prebi-rating-evaluator', evaluatorId) }
    catch { setError('Der Bewertungscode konnte nicht lokal gespeichert werden. Exportieren Sie Ihren Stand zur Sicherung.') }
  }, [evaluatorId])

  useEffect(() => {
    try { localStorage.setItem('prebi-rating-panel', panelId) }
    catch { setError('Die Panel-ID konnte nicht lokal gespeichert werden.') }
  }, [panelId])

  useEffect(() => {
    if (persistence !== 'saving' && persistence !== 'error') return
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [persistence])

  useEffect(() => {
    if (session) return
    let cancelled = false
    setSavedSessions([])
    listSessions<unknown>(identity ? `expert::${identity}::` : 'expert::').then(async (entries: { key: string; value: unknown }[]) => {
      const sessions: ExpertSession[] = []
      for (const entry of entries) {
        const saved = await validateSession(entry.value)
        if (sessionKey(saved) !== entry.key) throw new Error('Lokaler Sitzungsschlüssel stimmt nicht mit dem Inhalt überein.')
        if (!identity || saved.evaluator_id === identity) sessions.push(saved)
      }
      if (!cancelled) setSavedSessions(sessions)
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Lokale Sitzungen konnten nicht gelesen werden.') })
    return () => { cancelled = true }
  }, [identity, session])

  useEffect(() => {
    if (!session) return
    const snapshot = session
    const fingerprint = canonicalJson(snapshot)
    if (fingerprint === autosaveBaseline.current) return
    const token = generation.current
    setPersistence('saving')
    writeQueue.current = writeQueue.current.then(async () => {
      if (token !== generation.current) return
      const save = async () => {
        const existing = await readSession<unknown>(sessionKey(snapshot))
        if ((existing === undefined ? undefined : canonicalJson(existing)) !== expectedFingerprint.current) throw new Error('Diese Sitzung wurde in einem anderen Tab geändert. Prüfen Sie den gespeicherten Stand oder exportieren Sie Ihren aktuellen Stand.')
        await writeSession(sessionKey(snapshot), snapshot)
        expectedFingerprint.current = fingerprint
        autosaveBaseline.current = fingerprint
      }
      if (navigator.locks) await navigator.locks.request(`prebi:${sessionKey(snapshot)}`, save)
      else throw new Error('Dieser Browser unterstützt keine sichere tabübergreifende Speicherung. Exportieren Sie Ihren Stand oder verwenden Sie einen aktuellen Browser.')
      if (token === generation.current && canonicalJson(currentSession.current) === fingerprint) {
        setPersistence('saved')
        setError('')
      }
    }).catch(caught => {
      if (token === generation.current) {
        setPersistence('error')
        setError(caught instanceof Error ? caught.message : 'Die lokale Speicherung ist fehlgeschlagen. Exportieren Sie Ihren Stand zur Sicherung.')
      }
    })
  }, [session, saveAttempt])

  useEffect(() => {
    const editor = packet ? currentSession.current?.pending_editors?.[packet.packet_id] : undefined
    setSelectedSpan(editor?.selection ?? null)
    setSpanComment(editor?.comment ?? '')
    setSpanTags(editor?.tags ?? [])
  }, [packet?.packet_id])

  function rememberEditor(selection = selectedSpan, comment = spanComment, tags = spanTags) {
    if (!packet || consensusFinalized) return
    setSession(current => {
      if (!current) return current
      const editor = { selection, comment, tags }
      const previous = current.pending_editors?.[packet.packet_id] ?? { selection: null, comment: '', tags: [] }
      if (canonicalJson(previous) === canonicalJson(editor)) return current
      const editors = { ...current.pending_editors }
      if (selection === null && !comment && !tags.length) delete editors[packet.packet_id]
      else editors[packet.packet_id] = editor
      return { ...current, pending_editors: editors }
    })
  }

  function editSpanComment(value: string) {
    setSpanComment(value)
    rememberEditor(selectedSpan, value, spanTags)
  }

  function editSpanTags(value: string[]) {
    setSpanTags(value)
    rememberEditor(selectedSpan, spanComment, value)
  }

  function navigateCriterion(index: number) {
    setSession(current => current ? { ...current, active_criterion: index } : current)
  }

  function nextCriterion() {
    navigateCriterion(Math.min(steps.length - 1, criterionIndex + 1))
  }

  function navigatePacket(index: number) {
    setSession(current => current ? { ...current, active_index: index, active_criterion: 0 } : current)
  }

  function nextCase() {
    if (packetIndex < taskPackets.length - 1) navigatePacket(packetIndex + 1)
    else {
      const tasks = availableTasks(packets, consensusMode)
      const nextTask = tasks[tasks.indexOf(taskFilter) + 1]
      if (nextTask) setSession(current => current ? { ...current, active_task: nextTask, active_index: 0, active_criterion: 0 } : current)
      else setExportOpen(true)
    }
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!packet || !draft) return
    if (consensusFinalized) {
      setError('Öffnen Sie den Konsens zur Bearbeitung, bevor Sie Antworten ändern.')
      return
    }
    try {
      const next = validateDraft(packet, { ...draft, ...patch })
      setSession(current => {
        if (!current) return current
        const record = current.consensus?.[packet.packet_id]
        return { ...current, drafts: { ...current.drafts, [packet.packet_id]: next }, ...(record?.status === 'flagged' ? { consensus: { ...current.consensus, [packet.packet_id]: resumeConsensus(record) } } : {}) }
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ungültige Antwort.')
    }
  }

  function editConsensusNote(value: string) {
    if (!packet || !consensusRecord || consensusFinalized) return
    setSession(current => {
      const record = current?.consensus?.[packet.packet_id]
      return current && record ? { ...current, consensus: { ...current.consensus, [packet.packet_id]: { ...record, note: value } } } : current
    })
  }

  function flagCurrentCase() {
    if (!packet || !consensusRecord || consensusFinalized) return
    setSession(current => {
      const record = current?.consensus?.[packet.packet_id]
      return current && record ? { ...current, consensus: { ...current.consensus, [packet.packet_id]: flagConsensus(record) } } : current
    })
  }

  function resumeCurrentCase() {
    if (!packet || !consensusRecord || consensusFinalized) return
    setSession(current => {
      const record = current?.consensus?.[packet.packet_id]
      return current && record ? { ...current, consensus: { ...current.consensus, [packet.packet_id]: resumeConsensus(record) } } : current
    })
  }

  function finalizeCurrentCase() {
    if (!packet || !draft || !consensusRecord || !session?.panel_id || consensusFinalized) return
    const errors = consensusAnswerErrors(packet, draft)
    if (errors.length) {
      setError(errors.join(' '))
      return
    }
    setSession(current => {
      if (!current?.consensus || !current.panel_id) return current
      const consensus = finalizeConsensus(current.consensus[packet.packet_id], packet, current.drafts[packet.packet_id], current.panel_id)
      const assessmentReferences = { ...(current.assessment_reference_snapshots ?? emptyAssessmentReferences(current.packets)) }
      const c1Snapshots = { ...(current.c1_snapshots ?? emptyC1Snapshots(current.packets)) }
      if (packet.task === 'assessment_quality') {
        assessmentReferences[packet.packet_id] = captureAssessmentReference(packet, current)
      }
      if (packet.task === 'feedback_quality') {
        c1Snapshots[packet.packet_id] = [...(c1Snapshots[packet.packet_id] ?? []), captureC1Snapshot(packet, current.drafts[packet.packet_id], consensus, current.panel_id)]
      }
      return {
        ...current,
        consensus: { ...current.consensus, [packet.packet_id]: consensus },
        ...(current.schema_version === '1.2.0' ? { assessment_reference_snapshots: assessmentReferences, c1_snapshots: c1Snapshots } : {}),
      }
    })
    setError('')
  }

  function confirmCurrentAssessmentReference() {
    if (!packet || packet.task !== 'assessment_quality' || !session || !consensusFinalized) return
    const currentSnapshot = finalizedAssessmentReference(packet, session)
    if (!currentSnapshot) return
    setSession(current => {
      if (!current) return current
      const records = { ...(current.assessment_reference_snapshots ?? emptyAssessmentReferences(current.packets)) }
      const previous = records[packet.packet_id] ?? { used_snapshot: null, reviewed_snapshot: null, reviewed_at: null }
      records[packet.packet_id] = { ...previous, reviewed_snapshot: currentSnapshot, reviewed_at: new Date().toISOString() }
      return { ...current, assessment_reference_snapshots: records }
    })
  }

  function openHistoricalComparison() {
    if (!session || !feedbackC1GateReady(session)) return
    try {
      const comparison = enterFeedbackComparison(session)
      setSession(current => current ? { ...current, feedback_comparison: comparison } : current)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der historische Vergleich ist noch nicht verfügbar.')
    }
  }

  function returnToC1() {
    setSession(current => current?.feedback_comparison
      ? { ...current, feedback_comparison: { ...current.feedback_comparison, stage: 'c1' } }
      : current)
  }

  function updateCurrentC2Case(update: (comparison: NonNullable<ExpertSession['feedback_comparison']>['cases'][string], snapshot: NonNullable<ReturnType<typeof latestC1Snapshot>>) => NonNullable<ExpertSession['feedback_comparison']>['cases'][string]) {
    if (!packet || packet.task !== 'feedback_quality' || !session || !feedbackC2Active) return
    const snapshot = latestC1Snapshot(packet, session)
    if (!snapshot) return
    const state = session.feedback_comparison ?? emptyFeedbackComparison()
    const prepared = ensureFeedbackComparisonCase(packet, snapshot, state)
    const comparison = prepared.cases[packet.packet_id]
    try {
      const nextComparison = update(comparison, snapshot)
      setSession(current => current?.feedback_comparison
        ? { ...current, feedback_comparison: { ...current.feedback_comparison, cases: { ...current.feedback_comparison.cases, [packet.packet_id]: nextComparison } } }
        : current)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der Vergleich konnte nicht gespeichert werden.')
    }
  }

  function decideCurrentC2(decision: 'keep' | 'revised') {
    if (decision === 'revised') {
      updateCurrentC2Case(comparison => ({ ...comparison, decision: 'revised' }))
      return
    }
    updateCurrentC2Case((comparison, snapshot) => finalizeFeedbackComparison(packet!, snapshot, {
      ...comparison,
      decision: 'keep',
      revised_criterion_ratings: Object.fromEntries(Object.entries(snapshot.criterion_ratings).map(([id, answer]) => [id, answer.score])),
      revision_reasons: {},
    }))
  }

  function changeCurrentC2Score(criterionId: string, score: number | null) {
    updateCurrentC2Case(comparison => ({
      ...comparison,
      revised_criterion_ratings: { ...comparison.revised_criterion_ratings, [criterionId]: score },
    }))
  }

  function changeCurrentC2Reason(criterionId: string, reason: string) {
    updateCurrentC2Case(comparison => ({
      ...comparison,
      revision_reasons: { ...comparison.revision_reasons, [criterionId]: reason },
    }))
  }

  function finalizeCurrentC2() {
    updateCurrentC2Case((comparison, snapshot) => finalizeFeedbackComparison(packet!, snapshot, comparison))
  }

  function reopenCurrentC2() {
    updateCurrentC2Case(comparison => reopenFeedbackComparison(comparison))
  }

  function reopenCurrentCase() {
    if (!packet || !consensusRecord || !consensusFinalized) return
    setSession(current => {
      const record = current?.consensus?.[packet.packet_id]
      return current && record ? {
        ...current,
        consensus: { ...current.consensus, [packet.packet_id]: reopenConsensus(record) },
        ...(packet.task === 'feedback_quality' && current.feedback_comparison
          ? { feedback_comparison: { ...current.feedback_comparison, stage: 'c1' } }
          : {}),
      } : current
    })
    setError('')
  }

  async function installSession(chosen: ExpertSession, fingerprint: string | undefined) {
    await writeQueue.current
    if (chosen.evaluation_mode === 'expert_consensus' && chosen.schema_version === '1.1.0') {
      chosen = { ...chosen, schema_version: '1.2.0', assessment_reference_snapshots: emptyAssessmentReferences(chosen.packets), c1_snapshots: emptyC1Snapshots(chosen.packets), feedback_comparison: emptyFeedbackComparison() }
    }
    const existing = await readSession<unknown>(sessionKey(chosen))
    const actual = existing === undefined ? undefined : canonicalJson(existing)
    if (actual !== fingerprint) {
      if (existing !== undefined) setPending({ incoming: chosen, saved: await validateSession(existing), fingerprint: actual, conflict: true })
      throw new Error('Der lokale Stand wurde inzwischen geändert. Bitte wählen Sie den gewünschten Stand erneut.')
    }
    generation.current += 1
    expectedFingerprint.current = fingerprint
    const unchanged = existing !== undefined && canonicalJson(await validateSession(existing)) === canonicalJson(chosen)
    autosaveBaseline.current = unchanged ? canonicalJson(chosen) : fingerprint
    const activePacket = chosen.packets.filter(packet => packet.task === chosen.active_task)[chosen.active_index]
    const editor = chosen.pending_editors?.[activePacket.packet_id]
    setSelectedSpan(editor?.selection ?? null)
    setSpanComment(editor?.comment ?? '')
    setSpanTags(editor?.tags ?? [])
    if (chosen.evaluation_mode === 'expert_consensus') {
      setEvaluationMode('expert_consensus')
      setPanelId(chosen.panel_id ?? chosen.evaluator_id)
    } else {
      setEvaluationMode('individual')
      setEvaluatorId(chosen.evaluator_id)
    }
    setSession(chosen)
    setPending(null)
    setExportOpen(false)
    setPersistence(unchanged ? 'saved' : 'saving')
    setError('')
  }

  async function prepareSession(incoming: ExpertSession, imported: boolean) {
    await writeQueue.current
    const all = await listSessions<unknown>('expert::')
    for (const entry of all) {
      const saved = await validateSession(entry.value)
      if (sessionKey(saved) !== entry.key) throw new Error('Lokaler Sitzungsschlüssel stimmt nicht mit dem Inhalt überein.')
      assertSourcesMatch(incoming.packets, saved.packets)
    }
    checkLegacySources(incoming.packets)
    if (session) assertSourcesMatch(incoming.packets, session.packets)
    const value = await readSession<unknown>(sessionKey(incoming))
    if (value !== undefined) {
      const saved = await validateSession(value)
      setPending({ incoming, saved, fingerprint: canonicalJson(value), conflict: imported && canonicalJson(incoming) !== canonicalJson(saved) })
      return
    }
    if (imported) {
      await installSession(incoming, undefined)
      return
    }
    if (incoming.evaluation_mode === 'expert_consensus') {
      await installSession(incoming, undefined)
      return
    }
    const legacyDrafts = legacyObject(STORAGE_KEY)
    const records = legacyRatings()
    const drafts = { ...incoming.drafts }
    for (const packet of incoming.packets) {
      const key = queueKey(packet, incoming.evaluator_id)
      if (Object.hasOwn(legacyDrafts, key)) drafts[packet.packet_id] = legacyDraft(packet, legacyDrafts[key])
      else if (records[key]) drafts[packet.packet_id] = draftFromResponse(packet, records[key].response)
    }
    const recovered = { ...incoming, drafts }
    if (incoming.packets.some(packet => expertCaseState(packet, recovered) !== 'not_started')) setPending({ incoming, saved: recovered, fingerprint: undefined, conflict: false })
    else await installSession(incoming, undefined)
  }

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Die Sitzung konnte nicht geöffnet werden.') }
    finally { setBusy(false) }
  }

  async function importPacketFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    await attempt(async () => {
      const parsed: unknown = JSON.parse(await file.text())
      if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'kind')) {
        const imported = await validateSession(parsed)
        if (imported.evaluation_mode === 'expert_consensus') {
          if (panelId.trim() && imported.panel_id !== panelId.trim()) throw new Error('Die Sitzung gehört zu einem anderen Panel.')
          setPanelId(imported.panel_id ?? imported.evaluator_id)
        } else {
          if (!evaluatorId.trim() || imported.evaluator_id !== evaluatorId.trim()) throw new Error('Die Sitzung gehört zu einem anderen Bewertungscode.')
        }
        await prepareSession(imported, true)
        return
      }
      const activeIdentity = evaluationMode === 'expert_consensus' ? panelId.trim() : evaluatorId.trim()
      if (!activeIdentity) throw new Error(evaluationMode === 'expert_consensus' ? 'Geben Sie eine Panel-ID ein, bevor Sie die Konsenssitzung öffnen.' : 'Geben Sie Ihren Bewertungscode ein, bevor Sie eine Sitzung öffnen.')
      const loaded = validatePackets(Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'packets') ? (parsed as { packets: unknown }).packets : [parsed])
      if (evaluationMode === 'expert_consensus') {
        if (!availableTasks(loaded, true).length) throw new Error('Das Paket enthält keine Fälle für die drei primären Konsensaufgaben.')
        assertConsensusBlinding(loaded)
      }
      await checkPacketHashes(loaded)
      const hash = await bundleHash(loaded)
      const ordered = [...loaded]
      for (let index = ordered.length - 1; index > 0; index--) {
        const next = Math.floor(Math.random() * (index + 1))
        ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
      }
      const incoming: ExpertSession = evaluationMode === 'expert_consensus'
        ? { kind: 'prebi_expert_session', schema_version: '1.2.0', evaluator_id: activeIdentity, evaluation_mode: 'expert_consensus', panel_id: activeIdentity, bundle_sha256: hash, packets: ordered, drafts: Object.fromEntries(ordered.map(packet => [packet.packet_id, emptyDraft(packet)])), pending_editors: {}, consensus: emptyConsensus(ordered), assessment_reference_snapshots: emptyAssessmentReferences(ordered), c1_snapshots: emptyC1Snapshots(ordered), feedback_comparison: emptyFeedbackComparison(), active_task: firstTask(ordered, true), active_index: 0, active_criterion: 0 }
        : { kind: 'prebi_expert_session', schema_version: '1.0.0', evaluator_id: activeIdentity, bundle_sha256: hash, packets: ordered, drafts: Object.fromEntries(ordered.map(packet => [packet.packet_id, emptyDraft(packet)])), pending_editors: {}, active_task: firstTask(ordered), active_index: 0, active_criterion: 0 }
      await prepareSession(evaluationMode === 'expert_consensus' ? await validateSession(incoming) : incoming, false)
    })
  }

  function chooseSession(chosen: ExpertSession) {
    if (!pending || busy) return
    void attempt(() => installSession(chosen, pending.fingerprint))
  }

  function restartSession() {
    if (!pending || !window.confirm('Diese Sitzung neu beginnen? Der gespeicherte Stand wird ersetzt. Exportieren Sie ihn vorher, wenn Sie ihn behalten möchten.')) return
    chooseSession(freshSession(pending.incoming))
  }

  function addSpanComment() {
    if (!selectedSpan || !spanComment.trim() || consensusFinalized) return
    const comment: SpanComment = { feedback_component: selectedSpan.component, feedback_item_index: selectedSpan.index, start_character: selectedSpan.start, end_character: selectedSpan.end, comment: spanComment.trim(), tags: spanTags, linked_reflection_segment_ids: [] }
    updateDraft({ spanComments: [...(draft?.spanComments ?? []), comment] })
    rememberEditor(null, '', [])
    setSpanComment('')
    setSpanTags([])
    setSelectedSpan(null)
  }

  function handleFeedbackSelection(event: React.SyntheticEvent<HTMLTextAreaElement>, component: string, index: number) {
    if (consensusFinalized) return
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    if (start < end) {
      const selection = { component, index, start, end, quote: target.value.slice(start, end) }
      setSelectedSpan(selection)
      rememberEditor(selection)
    }
  }

  function exportSession() {
    if (!session) return
    downloadJson(`expert-session-${session.evaluator_id}.json`, session)
    setExportOpen(false)
  }

  function exportResearch() {
    if (!session) return
    if (session.evaluation_mode === 'expert_consensus') {
      const exported = consensusResearchExport(session)
      if (exported.ratings.length) downloadJson('ratings-consensus.json', exported)
      return
    }
    const previous = legacyRatings()
    const records: SavedRating[] = exportPackets.map(packet => {
      const consensus = session.evaluation_mode === 'expert_consensus' ? session.consensus?.[packet.packet_id] : undefined
      const prior = consensus ? undefined : previous[queueKey(packet, session.evaluator_id)]
      const response = responseForDraft(packet, session.drafts[packet.packet_id])
      const unchangedPrior = prior && canonicalJson(prior.response) === canonicalJson(response)
      return { schema_version: consensus ? '1.1.0' : '1.0.0', rating_id: prior?.rating_id ?? crypto.randomUUID(), packet_id: packet.packet_id, task: packet.task, evaluator_type: 'human', evaluator_id: session.evaluator_id, protocol_id: packet.protocol_id, protocol_version: packet.protocol_version, ...(packet.task === 'reflection_reference_score' ? unchangedPrior ? (prior.scoring_scale_id ? { scoring_scale_id: prior.scoring_scale_id } : {}) : { scoring_scale_id: REFERENCE_SCORE_SCALE.id } : {}), packet_version: packet.packet_version, display_output_sha256: packet.display_output_sha256, displayed_reflection_sha256: packet.displayed_reflection_sha256, submitted_at: consensus?.finalized_at ?? (unchangedPrior ? prior.submitted_at : new Date().toISOString()), response, ...(consensus ? { evaluation_mode: 'expert_consensus' as const, panel_id: session.panel_id, ...(session.panel_members ? { panel_members: session.panel_members } : {}), consensus } : {}) }
    })
    if (records.length) downloadJson('ratings-evaluation.json', { schema_version: '1.0.0', ratings: records })
  }

  function inspectSaved() {
    if (!session) return
    void attempt(async () => {
      await writeQueue.current
      const value = await readSession<unknown>(sessionKey(session))
      if (value === undefined) throw new Error('Noch kein lokal gespeicherter Stand vorhanden. Versuchen Sie die Speicherung erneut oder exportieren Sie Ihren Stand.')
      const saved = await validateSession(value)
      assertSourcesMatch(session.packets, saved.packets)
      setPending({ incoming: session, saved, fingerprint: canonicalJson(value), conflict: true })
    })
  }

  const pendingConsensus = pending?.saved.evaluation_mode === 'expert_consensus'
  const pendingPackets = pending?.saved.packets.filter(item => !pendingConsensus || item.task !== 'feedback_implied_score') ?? []
  const pendingStarted = pending?.saved.packets.filter(item => pendingConsensus
    ? item.task !== 'feedback_implied_score' && consensusCaseState(item, pending.saved) !== 'not_started'
    : expertCaseState(item, pending.saved) !== 'not_started').length ?? 0
  const consensusPacketStates = session?.packets.filter(item => item.task !== 'feedback_implied_score').map(item => consensusCaseState(item, session)) ?? []
  const consensusSummary = consensusMode ? {
    finalized: consensusPacketStates.filter(state => state === 'finalized').length,
    inProgress: consensusPacketStates.filter(state => state === 'in_progress').length,
    flagged: consensusPacketStates.filter(state => state === 'flagged').length,
    notStarted: consensusPacketStates.filter(state => state === 'not_started').length,
  } : undefined
  const referenceDimension = packet?.task === 'reflection_reference_score' ? packet.score_dimensions?.[criterionIndex] : undefined
  const referenceAnswer = referenceDimension && draft ? draft.referenceAnswers[referenceDimension.dimension_id] : undefined
  const taskBReference = packet?.task === 'assessment_quality' && session && consensusMode
    ? assessmentReferenceState(packet, session)
    : undefined
  const c2Snapshot = packet?.task === 'feedback_quality' && session && feedbackC2Active
    ? latestC1Snapshot(packet, session)
    : null
  const c2State = feedbackC2Active ? session?.feedback_comparison : undefined
  const c2PreparedState = packet?.task === 'feedback_quality' && c2Snapshot && c2State
    ? ensureFeedbackComparisonCase(packet, c2Snapshot, c2State)
    : undefined
  const c2Case = packet?.task === 'feedback_quality' && c2PreparedState
    ? c2PreparedState.cases[packet.packet_id]
    : undefined
  function toggleReferenceEvidence(id: string) {
    if (!referenceDimension || !draft || !referenceAnswer) return
    const evidence = new Set(referenceAnswer.evidence_segment_ids)
    if (evidence.has(id)) evidence.delete(id)
    else evidence.add(id)
    updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [referenceDimension.dimension_id]: { ...referenceAnswer, evidence_segment_ids: [...evidence] } } })
  }

  return <AppShell workflow="Expert evaluation" context={session ? <><span>{TASK_LABELS[taskFilter]} · {doneCount} / {taskPackets.length} {consensusMode ? 'Konsens erreicht' : 'Fälle vollständig'}</span><label className="annotator-field">{consensusMode ? 'Panel-ID' : 'Bewertungscode'}<input value={consensusMode ? session.panel_id ?? session.evaluator_id : session.evaluator_id} disabled autoComplete="off" /></label></> : undefined}>
    {error && <div className="rating-error" role="alert">{error}</div>}
    {pending ? <section className="evaluation-start" aria-busy={busy}>
      {pending.conflict ? <div className="start-content"><h1>Unterschiedliche Sitzungsstände</h1><p>Die Datei und der lokal gespeicherte Stand unterscheiden sich.</p><div className="rating-actions"><button className="submit-button" disabled={busy} onClick={() => chooseSession(pending.saved)}>Lokalen Stand fortsetzen</button><button className="icon-button" disabled={busy} onClick={() => chooseSession(pending.incoming)}>Geöffneten Stand verwenden</button><button className="icon-button" disabled={busy} onClick={() => setPending(null)}>Abbrechen</button></div><button className="icon-button" onClick={() => downloadJson('expert-session-local-backup.json', pending.saved)}><Download size={16} />Lokalen Stand sichern</button></div> : <ResumePrompt count={pendingStarted} total={pendingPackets.length} onContinue={() => chooseSession(pending.saved)} onRestart={restartSession} onCancel={() => setPending(null)} />}
    </section> : !session ? <main className="evaluation-start" aria-busy={busy}>
      <section className="start-content"><h1>Expertenbewertung</h1><fieldset className="evaluation-mode-choice"><legend>Bewertungsmodus</legend><label><input type="radio" name="evaluation-mode" checked={evaluationMode === 'individual'} onChange={() => { setEvaluationMode('individual'); setSavedSessions([]); setError('') }} />Einzelbewertung</label><label><input type="radio" name="evaluation-mode" checked={evaluationMode === 'expert_consensus'} onChange={() => { setEvaluationMode('expert_consensus'); setSavedSessions([]); setError('') }} />Gemeinsame Konsensbewertung</label></fieldset>
        {evaluationMode === 'expert_consensus' ? <><label className="annotator-field start-annotator">Panel-ID<input value={panelId} onChange={event => { setPanelId(event.target.value); setSavedSessions([]); setError('') }} placeholder="expert-panel-01" autoComplete="off" disabled={busy} /></label><p className="mode-note">Eine Person bedient die Sitzung stellvertretend für das Expert:innenpanel. Einzelratings und ältere Sitzungen werden nicht als Konsens übernommen.</p></> : <label className="annotator-field start-annotator">Bewertungscode<input value={evaluatorId} onChange={event => { setEvaluatorId(event.target.value); setSavedSessions([]); setError('') }} placeholder="Ihr zugewiesener Code" autoComplete="off" disabled={busy} /></label>}
        <PacketFileButton onImport={importPacketFile} primary /><WorkflowHelp />
        {!!savedSessions.length && <section aria-label="Gespeicherte Sitzungen"><h2>Gespeicherte Sitzungen</h2>{savedSessions.map(saved => <button className="icon-button" key={sessionKey(saved)} disabled={busy} onClick={() => void attempt(() => prepareSession(saved, false))}><ChevronRight size={16} />{saved.evaluation_mode === 'expert_consensus' ? 'Konsenspanel' : 'Einzelbewertung'} · {saved.evaluator_id} · {saved.packets.length} Fälle · {saved.packets.filter(item => saved.evaluation_mode === 'expert_consensus' ? item.task !== 'feedback_implied_score' && consensusCaseState(item, saved) !== 'not_started' : expertCaseState(item, saved) !== 'not_started').length} begonnen</button>)}</section>}
        <details className="start-storage-actions"><summary>Ältere Forschungsbewertungen</summary><p>{savedForEvaluator.length} gespeicherte Bewertungen</p><button className="icon-button" disabled={!savedForEvaluator.length} onClick={() => downloadJson('ratings-stored.json', { schema_version: '1.0.0', ratings: savedForEvaluator })}><Download size={16} />Forschungsformat exportieren</button></details>
      </section>
    </main> : <>
      <div className="rating-toolbar"><div className="task-tabs" role="tablist" aria-label="Bewertungsaufgabe">{availableTasks(packets, consensusMode).map(task => <button key={task} role="tab" aria-selected={taskFilter === task} className={taskFilter === task ? 'active' : ''} onClick={() => setSession(current => current ? { ...current, active_task: task, active_index: 0, active_criterion: 0 } : current)}>{TASK_LABELS[task]}</button>)}</div><div className="rating-actions"><button className="icon-button" onClick={() => setExportOpen(true)} disabled={!startedCount}><Download size={16} />{consensusMode ? 'Arbeitsstand exportieren' : 'Stand exportieren'}</button>{consensusMode && (feedbackC2Active ? <button className="icon-button" onClick={returnToC1}>Zur C1-Bewertung</button> : <button className="icon-button" disabled={!feedbackC1Ready} onClick={openHistoricalComparison}>{feedbackC1Ready ? 'Historischer Vergleich' : 'Vergleich noch nicht verfügbar'}</button>)}<details className="file-management"><summary><FileJson size={18} />Dateien &amp; technische Details</summary><div className="rating-actions"><PacketFileButton onImport={importPacketFile} /><button className="icon-button" disabled={!completeCount} onClick={exportResearch}><Download size={16} />{consensusMode ? 'Finalisierte Konsensratings exportieren' : 'Vollständige Bewertungen im Forschungsformat'}</button><button className="icon-button" onClick={() => setPending({ incoming: session, saved: session, fingerprint: expectedFingerprint.current, conflict: false })}>Neu beginnen</button><button className="icon-button" onClick={() => { if (persistence !== 'saved' && !window.confirm('Der aktuelle Stand ist noch nicht sicher gespeichert. Trotzdem zur Startseite wechseln?')) return; generation.current += 1; setSession(null); setPersistence('idle'); setError('') }}>Sitzung schließen</button></div><p>Bundle: {session.bundle_sha256}</p>{packet && <dl><dt>Fall-ID</dt><dd>{packet.packet_id}</dd><dt>Paketversion</dt><dd>{packet.packet_version}</dd><dt>Protokoll</dt><dd>{packet.protocol_id} · {packet.protocol_version}</dd><dt>Ausgabe-Prüfsumme</dt><dd>{packet.display_output_sha256 ?? 'Nicht vorhanden'}</dd><dt>Reflexions-Prüfsumme</dt><dd>{packet.displayed_reflection_sha256 ?? 'Nicht vorhanden'}</dd></dl>}</details></div></div>
      <div className="rating-status"><ShieldCheck size={16} /><PersistenceStatus state={persistence} /></div>
      {persistence === 'error' && <div className="rating-actions"><button className="icon-button" onClick={() => setSaveAttempt(value => value + 1)}>Speicherung erneut versuchen</button><button className="icon-button" onClick={inspectSaved}>Gespeicherten Stand prüfen</button><button className="icon-button" onClick={exportSession}><Download size={16} />Aktuellen Stand sichern</button></div>}
      <WorkflowHelp consensus={consensusMode} />
      {exportOpen && <ExportSummary total={consensusMode ? consensusPacketStates.length : packets.length} complete={completeCount} started={startedCount - completeCount} consensus={consensusSummary} onExport={exportSession} onClose={() => setExportOpen(false)} />}
      {packet && draft && <div className="rating-layout"><PacketNavigator label={TASK_LABELS[taskFilter]} states={packetStates} activeIndex={packetIndex} onNavigate={navigatePacket} consensusMode={consensusMode} consensusStatuses={consensusMode ? consensusStates : undefined}>
        <details className="protocol-details"><summary>Bewertungsleitfaden</summary><pre>{packet.human_protocol}</pre></details><details className="rubric-details"><summary>Bewertungsraster</summary>{packet.rubric.dimensions.map(dimension => <div className="rubric-dimension" key={dimension.dimension_id}><strong>{dimension.dimension_id} · {dimension.name}</strong><p>{dimension.description}</p><dl>{Object.entries(dimension.bands).map(([band, description]) => <div key={band}><dt>{band}</dt><dd>{description}</dd></div>)}</dl></div>)}</details>
      </PacketNavigator><main className="rating-main"><SourceComparison key={packet.packet_id} packet={packet} onSelection={handleFeedbackSelection} referenceEvidence={referenceDimension && referenceAnswer && !consensusFinalized ? { ids: referenceAnswer.evidence_segment_ids, label: referenceDimension.label, onToggle: toggleReferenceEvidence } : undefined} assessmentReference={taskBReference ? {
        state: taskBReference.state,
        scores: taskBReference.current?.scores ?? null,
        onConfirm: consensusFinalized && taskBReference.current && (taskBReference.state === 'changed' || taskBReference.state === 'available')
          ? confirmCurrentAssessmentReference
          : undefined,
      } : undefined} historicalFeedback={feedbackC2Active && packet.task === 'feedback_quality' && packet.human_feedback?.trim() ? packet.human_feedback : undefined}><section className={`task-panel${feedbackC2Active && packet.task === 'feedback_quality' ? ' c2-panel' : ''}`} aria-label={feedbackC2Active && packet.task === 'feedback_quality' ? 'Historischer Vergleich' : 'Ihre Bewertung'}><div className="panel-title"><span>{feedbackC2Active && packet.task === 'feedback_quality' ? 'Historischer Vergleich' : 'Ihre Bewertung'}</span></div>
        {feedbackC2Active && packet.task === 'feedback_quality' ? packet.human_feedback?.trim() && c2Snapshot && c2Case
          ? <FeedbackComparisonControls packet={packet} snapshot={c2Snapshot} comparison={c2Case} onDecision={decideCurrentC2} onScoreChange={changeCurrentC2Score} onReasonChange={changeCurrentC2Reason} onFinalize={finalizeCurrentC2} onReopen={reopenCurrentC2} />
          : <div className="comparison-unavailable" role="status"><strong>Vergleich noch nicht verfügbar</strong><p>Für diesen Fall liegt kein historisches Feedback vor.</p></div>
          : <>
            {packet.task === 'feedback_implied_score' ? <p className="draft-progress">{steps.filter((_, index) => !answerError(packet, draft, index)).length} / {steps.length} Dimensionen vollständig</p> : <RatingProgress packet={packet} draft={draft} activeIndex={criterionIndex} onNavigate={navigateCriterion} />}
            {packet.task !== 'feedback_implied_score' && <p className="criterion-position">{packet.task === 'reflection_reference_score' ? 'Dimension' : 'Kriterium'} {criterionIndex + 1} von {steps.length}</p>}
            <fieldset className="rating-edit-fieldset" disabled={consensusFinalized}>{packet.task === 'feedback_implied_score' ? <ScoreCoding packet={packet} draft={draft} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={editSpanComment} addSpanComment={addSpanComment} /> : packet.task === 'reflection_reference_score' ? <ReferenceRating key={`${packet.packet_id}-${criterionIndex}`} packet={packet} draft={draft} activeIndex={criterionIndex} updateDraft={updateDraft} /> : <QualityRating packet={packet} draft={draft} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={editSpanComment} spanTags={spanTags} setSpanTags={editSpanTags} addSpanComment={addSpanComment} />}</fieldset>
            {consensusMode && consensusRecord && <ConsensusControls key={packet.packet_id} status={consensusStatus} note={consensusRecord.note} answerComplete={packetState(packet) === 'complete'} answerErrors={consensusAnswerErrors(packet, draft)} finalizedAt={consensusRecord.finalized_at} finalizedBy={consensusRecord.finalized_by} finalizationHistory={consensusRecord.finalization_history} onNoteChange={editConsensusNote} onFlag={flagCurrentCase} onResume={resumeCurrentCase} onFinalize={finalizeCurrentCase} onReopen={reopenCurrentCase} />}
          </>}
      </section><footer className="rating-footer"><PersistenceStatus state={persistence} /><div>{packet.task !== 'feedback_implied_score' && <button className="icon-button" disabled={criterionIndex === 0} onClick={() => navigateCriterion(criterionIndex - 1)} title="Vorheriges Kriterium" aria-label="Vorheriges Kriterium"><ChevronLeft size={16} /></button>}{packet.task !== 'feedback_implied_score' && criterionIndex < steps.length - 1 ? <button className="submit-button" onClick={nextCriterion}>Nächstes Kriterium<ChevronRight size={16} /></button> : <button className="submit-button" onClick={nextCase}>Nächster Fall<ChevronRight size={16} /></button>}</div></footer></SourceComparison></main></div>}
    </>}
  </AppShell>
}

function ScoreCoding({ packet, draft, activeIndex, updateDraft, selectedSpan, spanComment, setSpanComment, addSpanComment }: {
  packet: Packet; draft: Draft; activeIndex: number; updateDraft: (patch: Partial<Draft>) => void
  selectedSpan: { component: string; index: number; start: number; end: number; quote: string } | null
  spanComment: string; setSpanComment: (value: string) => void; addSpanComment: () => void
}) {
  return <div>
    {selectedSpan?.component === 'human_feedback' && <div className="span-editor"><strong>Ausgewählter Beleg: „{selectedSpan.quote}“</strong><textarea value={spanComment} onChange={(event) => setSpanComment(event.target.value)} placeholder="Belegnotiz zu diesem Textausschnitt" rows={2} /><button className="icon-button" onClick={addSpanComment}>Belegnotiz hinzufügen</button></div>}
    <div className="score-grid">{(packet.score_dimensions ?? []).map((dimension, index) => {
      const answer = draft.scoreAnswers[dimension.dimension_id]
      return <article className="score-card" key={dimension.dimension_id} aria-current={index === activeIndex ? 'step' : undefined}>
        <header><span>{dimension.dimension_id}</span><strong>{dimension.label}</strong></header>
        <fieldset className="score-status"><legend>{dimension.dimension_id} · Ableitbarkeit</legend>{(['inferred_from_feedback', 'not_inferable'] as const).map(status => <label key={status}><input type="radio" name={`status-${dimension.dimension_id}`} checked={answer.status === status} onChange={() => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: status === 'inferred_from_feedback' ? { ...answer, status } : { status, score: null, confidence: 'not_inferable', rationale: answer.rationale, feedback_evidence: [] } } })} />{status === 'not_inferable' ? 'Nicht ableitbar' : 'Punktwert ableitbar'}</label>)}</fieldset>
        {answer.status === 'inferred_from_feedback' && <div className="two-column"><label className="field"><span>{dimension.dimension_id} · Punktwert <small>0,0–3,0</small></span><input type="number" min="0" max="3" step="0.1" value={answer.score ?? ''} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, score: event.target.value === '' ? null : Number(event.target.value) } } })} /></label><label className="field"><span>{dimension.dimension_id} · Sicherheit</span><select value={answer.confidence} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, confidence: event.target.value as ScoreAnswer['confidence'] } } })}><option value="not_inferable" disabled>Bitte wählen</option><option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option></select></label></div>}
        <label className="field"><span>{dimension.dimension_id} · Begründung <small>Erforderlich</small></span><textarea rows={2} required value={answer.rationale} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, rationale: event.target.value } } })} /></label>
        {selectedSpan?.component === 'human_feedback' && answer.status === 'inferred_from_feedback' && <button className="text-button use-evidence" onClick={() => { updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, feedback_evidence: [...answer.feedback_evidence, { start_character: selectedSpan.start, end_character: selectedSpan.end, quote: selectedSpan.quote }] } } }); }}>Textausschnitt als Beleg übernehmen</button>}
        {answer.feedback_evidence.map((evidence, index) => <p className="evidence-chip" key={`${evidence.start_character}-${index}`}>„{evidence.quote}“ <button className="text-button" onClick={() => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, feedback_evidence: answer.feedback_evidence.filter((_, itemIndex) => itemIndex !== index) } } })}>Entfernen</button></p>)}
      </article>
    })}</div>
  </div>
}

function ReferenceRating({ packet, draft, activeIndex, updateDraft }: {
  packet: Packet; draft: Draft; activeIndex: number; updateDraft: (patch: Partial<Draft>) => void
}) {
  const dimension = packet.score_dimensions?.[activeIndex]
  if (!dimension) return null
  const dimensionId = dimension.dimension_id
  const rubric = packet.rubric.dimensions.find(item => item.dimension_id === dimension.dimension_id)
  const answer = draft.referenceAnswers[dimension.dimension_id]
  if (!rubric || !answer) return null
  const bands = Object.entries(rubric.bands).sort(([left], [right]) => Number(left) - Number(right))
  const scale = packet.scale ?? REFERENCE_SCORE_SCALE
  const [scoreInput, setScoreInput] = useState(answer.score === null ? '' : answer.score.toFixed(1).replace('.', ','))
  const [scoreInputError, setScoreInputError] = useState('')
  const selectedAnchors = new Set(referenceAnchorScores(answer.score, bands.map(([score]) => Number(score))))
  const answerLabel = `${dimension.dimension_id} · ${dimension.label}`
  const inputId = `reference-score-${dimension.dimension_id}`
  const segmentNumbers = new Map(packet.reflection.segments.map(segment => [segment.segment_id, segment.order + 1]))
  function setReferenceScore(score: number | null) {
    if (score !== null && !isValidReferenceScore(score)) return
    setScoreInput(score === null ? '' : score.toFixed(1).replace('.', ','))
    setScoreInputError('')
    updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [dimensionId]: { ...answer, score } } })
  }
  function editReferenceScore(value: string) {
    setScoreInput(value)
    const parsed = parseReferenceScoreInput(value)
    if (!parsed.valid) {
      setScoreInputError('Geben Sie einen Wert von 0,0 bis 3,0 in Schritten von 0,5 ein.')
      if (answer.score !== null) updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [dimensionId]: { ...answer, score: null } } })
      return
    }
    setScoreInputError('')
    updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [dimensionId]: { ...answer, score: parsed.score } } })
  }
  return <article className="criterion reference-criterion">
    <div className="criterion-heading"><div><h3>{dimension.dimension_id} · {dimension.label}</h3><p>{rubric.description}</p></div></div>
    <p className="reference-scale-note">Die Stufen 0 bis 3 dienen als Bewertungsanker. Zwischenwerte in Schritten von 0,5 können vergeben werden, wenn die Reflexionsleistung zwischen zwei Ankern liegt.</p>
    <dl className="criterion-anchors reference-anchors">{bands.map(([score, descriptor]) => <div key={score} className={selectedAnchors.has(Number(score)) ? 'surrounding' : ''} aria-current={selectedAnchors.has(Number(score)) ? 'true' : undefined}><dt>{score}</dt><dd>{descriptor}</dd></div>)}</dl>
    <section className="reference-score-control" aria-label={`${answerLabel} · Bewertung`}>
      <div className="reference-score-heading"><strong>Bewertung</strong><output htmlFor={inputId}>{answer.score === null ? `Noch offen / ${scale.max.toFixed(1).replace('.', ',')}` : `${answer.score.toFixed(1).replace('.', ',')} / ${scale.max.toFixed(1).replace('.', ',')}`}</output></div>
      <div className="reference-score-entry"><div className="reference-range"><input type="range" min={scale.min} max={scale.max} step={scale.step ?? REFERENCE_SCORE_SCALE.step} value={answer.score ?? scale.min} disabled={answer.score === null} aria-label={`${answerLabel} · Schieberegler`} aria-valuetext={answer.score === null ? 'Keine Bewertung ausgewählt' : `${answer.score.toFixed(1)} von ${scale.max.toFixed(1)}`} className={answer.score === null ? 'unselected' : ''} onChange={event => setReferenceScore(Number(event.currentTarget.value))} /><div className="reference-range-labels" aria-hidden="true">{Array.from({ length: Math.round((scale.max - scale.min) / (scale.step ?? REFERENCE_SCORE_SCALE.step)) + 1 }, (_, index) => <span key={index}>{(scale.min + index * (scale.step ?? REFERENCE_SCORE_SCALE.step)).toFixed(1).replace('.', ',')}</span>)}</div></div>
        <label className="field reference-score-input" htmlFor={inputId}><span>Zahlwert <small>0,0 bis 3,0</small></span><input id={inputId} type="text" inputMode="decimal" value={scoreInput} aria-label={`${answerLabel} · Zahlwert`} aria-invalid={Boolean(scoreInputError)} aria-describedby={`${inputId}-help ${inputId}-error`} onChange={event => editReferenceScore(event.currentTarget.value)} /><small id={`${inputId}-help`}>Leeres Feld = unbeantwortet</small>{scoreInputError && <small className="reference-score-error" id={`${inputId}-error`} role="alert">{scoreInputError}</small>}</label>
      </div>
    </section>
    <label className="field"><span>{dimension.label} · Begründung <small>Optional</small></span><textarea rows={3} value={answer.rationale} onChange={event => updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [dimension.dimension_id]: { ...answer, rationale: event.target.value } } })} /></label>
    <div className="reference-evidence-summary"><strong>Belegsegmente <small>Optional</small></strong>{answer.evidence_segment_ids.length ? answer.evidence_segment_ids.map(id => <button className="text-button" type="button" key={id} onClick={() => updateDraft({ referenceAnswers: { ...draft.referenceAnswers, [dimension.dimension_id]: { ...answer, evidence_segment_ids: answer.evidence_segment_ids.filter(item => item !== id) } } })}>Segment {segmentNumbers.get(id)} entfernen</button>) : <span>Noch keine Segmente ausgewählt</span>}</div>
  </article>
}

function QualityRating({ packet, draft, activeIndex, updateDraft, selectedSpan, spanComment, setSpanComment, spanTags, setSpanTags, addSpanComment }: {
  packet: Packet; draft: Draft; activeIndex: number; updateDraft: (patch: Partial<Draft>) => void
  selectedSpan: { component: string; index: number; start: number; end: number; quote: string } | null
  spanComment: string; setSpanComment: (value: string) => void; spanTags: string[]; setSpanTags: (value: string[]) => void; addSpanComment: () => void
}) {
  return <div>
    {packet.task === 'feedback_quality' && <>
      {selectedSpan && <div className="span-editor"><strong>Ausgewählt: „{selectedSpan.quote}“</strong><textarea value={spanComment} onChange={(event) => setSpanComment(event.target.value)} placeholder="Kommentar zu diesem Feedbackausschnitt" rows={2} /><div className="tag-list">{TAGS.map((tag) => <label key={tag}><input type="checkbox" checked={spanTags.includes(tag)} onChange={(event) => setSpanTags(event.target.checked ? [...spanTags, tag] : spanTags.filter((value) => value !== tag))} />{TAG_LABELS[tag]}</label>)}</div><button className="icon-button" onClick={addSpanComment}>Kommentar hinzufügen</button></div>}
      {!!draft.spanComments.length && <div className="span-list"><h3>Kommentare zu Textausschnitten ({draft.spanComments.length})</h3>{draft.spanComments.map((comment, index) => <div key={`${comment.feedback_component}-${comment.feedback_item_index}-${comment.start_character}-${index}`}><span>{componentLabels[comment.feedback_component] ?? comment.feedback_component} · „{feedbackText(packet, comment.feedback_component, comment.feedback_item_index).slice(comment.start_character, comment.end_character)}“</span><p>{comment.comment}</p></div>)}</div>}
    </>}
    <div className="quality-criteria">{(packet.criteria ?? []).slice(activeIndex, activeIndex + 1).map((criterion) => {
      const answer = draft.criterionRatings[criterion.criterion_id]
      const scaleMin = packet.scale?.min ?? 1
      const scaleMax = packet.scale?.max ?? 5
      const scores = Array.from({ length: scaleMax - scaleMin + 1 }, (_, index) => scaleMin + index)
      const anchors = criterion.anchors ?? packet.scale?.anchors
      return <article className="criterion" key={criterion.criterion_id}>
        <div className="criterion-heading"><div><h3>{criterion.label}</h3><p>{criterion.description}</p></div></div>
        <div className="score-buttons" role="group" aria-label={`${criterion.label} · Punktwert`}>{scores.map((score) => <button key={score} disabled={answer.unable_to_judge} className={answer.score === score && !answer.unable_to_judge ? 'chosen' : ''} aria-pressed={answer.score === score && !answer.unable_to_judge} onClick={() => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, score, unable_to_judge: false } } })}><strong>{score}</strong><span>{anchors?.[String(score)] ?? `Punktwert ${score}`}</span></button>)}</div>
        <label className="unable"><input type="checkbox" checked={answer.unable_to_judge} onChange={(event) => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, score: event.target.checked ? null : answer.score, unable_to_judge: event.target.checked } } })} />Nicht beurteilbar</label>
        {answer.unable_to_judge ? <label className="field"><span>Begründung <small>Erforderlich</small></span><textarea rows={2} required value={answer.comment} onChange={(event) => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, comment: event.target.value } } })} /></label> : <details className="optional-comment"><summary>Kommentar{answer.comment ? ' · vorhanden' : ' · optional'}</summary><label className="field"><span>Begründung / Kommentar</span><textarea rows={2} value={answer.comment} onChange={(event) => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, comment: event.target.value } } })} /></label></details>}
      </article>
    })}</div>
    <label className="field overall-comment"><span>Gesamtkommentar <small>Optional</small></span><textarea rows={3} value={draft.overallComment} onChange={(event) => updateDraft({ overallComment: event.target.value })} /></label>
  </div>
}

function feedbackText(packet: Packet, component: string, index: number) {
  if (component !== 'strengths' && component !== 'weaknesses' && component !== 'suggestions') return ''
  return packet.output?.[component]?.[index]?.text ?? ''
}
