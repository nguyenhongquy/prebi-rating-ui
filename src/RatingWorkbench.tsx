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
import { componentLabels, type Draft, type Packet, type RatingTask, type ScoreAnswer, type SpanComment } from './ratingTypes'
import { answerError, canonicalJson, emptyDraft, evaluationSteps, responseForDraft, type CaseState } from './ratingValidation'
import RatingProgress from './RatingProgress'
import PacketNavigator from './PacketNavigator'
import { readSession, writeSession, listSessions } from './localSessions'
import { WorkflowHelp, ResumePrompt, ExportSummary, PersistenceStatus } from './WorkflowSupport'
import { assertSourcesMatch, bundleHash, checkPacketHashes, draftFromResponse, expertCaseState, legacyDraft, sessionKey, validateDraft, validatePackets, validateSession, type ExpertSession, type PendingEditor } from './expertSession'
type SavedRating = {
  schema_version: '1.0.0'
  rating_id: string
  packet_id: string
  task: RatingTask
  evaluator_type: 'human'
  evaluator_id: string
  protocol_id: string
  protocol_version: string
  packet_version: string
  display_output_sha256?: string
  displayed_reflection_sha256?: string
  submitted_at: string
  response: unknown
}

const TASK_LABELS: Record<RatingTask, string> = {
  feedback_implied_score: 'Aus Feedback abgeleiteter Punktwert',
  assessment_quality: 'Qualität der Einschätzung',
  feedback_quality: 'Feedbackqualität',
}
const STORAGE_KEY = 'prebi-rating-workbench-v1'
const TAGS = ['unsupported', 'inaccurate', 'vague', 'actionable', 'strength', 'concern', 'other']
const TAG_LABELS: Record<string, string> = { unsupported: 'Nicht belegt', inaccurate: 'Unzutreffend', vague: 'Unklar', actionable: 'Handlungsorientiert', strength: 'Stärke', concern: 'Bedenken', other: 'Sonstiges' }

function queueKey(packet: Packet, evaluatorId: string) {
  return `${evaluatorId.trim()}::${packet.packet_id}`
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
  return { ...session, drafts: Object.fromEntries(session.packets.map(packet => [packet.packet_id, emptyDraft(packet)])), pending_editors: {}, active_task: session.packets[0].task, active_index: 0, active_criterion: 0 }
}

type PendingSession = {
  incoming: ExpertSession
  saved: ExpertSession
  fingerprint: string | undefined
  conflict: boolean
}

export default function RatingWorkbench() {
  const [session, setSession] = useState<ExpertSession | null>(null)
  const [evaluatorId, setEvaluatorId] = useState(() => {
    try { return localStorage.getItem('prebi-rating-evaluator') ?? '' } catch { return '' }
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
  const taskFilter = session?.active_task ?? 'feedback_implied_score'
  const packetIndex = session?.active_index ?? 0
  const criterionIndex = session?.active_criterion ?? 0
  const taskPackets = packets.filter(packet => packet.task === taskFilter)
  const packet = taskPackets[packetIndex] ?? null
  const draft = packet ? session!.drafts[packet.packet_id] : null
  const packetState = (item: Packet): CaseState => session ? expertCaseState(item, session) : 'not_started'
  const packetStates: CaseState[] = taskPackets.map(packetState)
  const doneCount = packetStates.filter(state => state === 'complete').length
  const completeCount = packets.filter(item => packetState(item) === 'complete').length
  const startedCount = packets.filter(item => packetState(item) !== 'not_started').length
  const steps = packet ? evaluationSteps(packet) : []
  const savedForEvaluator = Object.values(legacyRatings()).filter(rating => rating.evaluator_id === evaluatorId.trim())

  useEffect(() => {
    try { localStorage.setItem('prebi-rating-evaluator', evaluatorId) }
    catch { setError('Der Bewertungscode konnte nicht lokal gespeichert werden. Exportieren Sie Ihren Stand zur Sicherung.') }
  }, [evaluatorId])

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
    listSessions<unknown>(evaluatorId.trim() ? `expert::${evaluatorId.trim()}::` : 'expert::').then(async (entries: { key: string; value: unknown }[]) => {
      const sessions: ExpertSession[] = []
      for (const entry of entries) {
        const saved = await validateSession(entry.value)
        if (sessionKey(saved) !== entry.key) throw new Error('Lokaler Sitzungsschlüssel stimmt nicht mit dem Inhalt überein.')
        if (!evaluatorId.trim() || saved.evaluator_id === evaluatorId.trim()) sessions.push(saved)
      }
      if (!cancelled) setSavedSessions(sessions)
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Lokale Sitzungen konnten nicht gelesen werden.') })
    return () => { cancelled = true }
  }, [evaluatorId, session])

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
    if (!packet) return
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
      const tasks = (Object.keys(TASK_LABELS) as RatingTask[]).filter(task => packets.some(item => item.task === task))
      const nextTask = tasks[tasks.indexOf(taskFilter) + 1]
      if (nextTask) setSession(current => current ? { ...current, active_task: nextTask, active_index: 0, active_criterion: 0 } : current)
      else setExportOpen(true)
    }
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!packet || !draft) return
    try {
      const next = validateDraft(packet, { ...draft, ...patch })
      setSession(current => current ? { ...current, drafts: { ...current.drafts, [packet.packet_id]: next } } : current)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ungültige Antwort.')
    }
  }

  async function installSession(chosen: ExpertSession, fingerprint: string | undefined) {
    await writeQueue.current
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
    setEvaluatorId(chosen.evaluator_id)
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
      if (!evaluatorId.trim()) throw new Error('Geben Sie Ihren Bewertungscode ein, bevor Sie eine Sitzung öffnen.')
      const parsed: unknown = JSON.parse(await file.text())
      if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'kind')) {
        const imported = await validateSession(parsed)
        if (imported.evaluator_id !== evaluatorId.trim()) throw new Error('Die Sitzung gehört zu einem anderen Bewertungscode.')
        await prepareSession(imported, true)
        return
      }
      const loaded = validatePackets(Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'packets') ? (parsed as { packets: unknown }).packets : [parsed])
      await checkPacketHashes(loaded)
      const hash = await bundleHash(loaded)
      const ordered = [...loaded]
      for (let index = ordered.length - 1; index > 0; index--) {
        const next = Math.floor(Math.random() * (index + 1))
        ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
      }
      const incoming: ExpertSession = { kind: 'prebi_expert_session', schema_version: '1.0.0', evaluator_id: evaluatorId.trim(), bundle_sha256: hash, packets: ordered, drafts: Object.fromEntries(ordered.map(packet => [packet.packet_id, emptyDraft(packet)])), pending_editors: {}, active_task: ordered[0].task, active_index: 0, active_criterion: 0 }
      await prepareSession(incoming, false)
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
    if (!selectedSpan || !spanComment.trim()) return
    const comment: SpanComment = { feedback_component: selectedSpan.component, feedback_item_index: selectedSpan.index, start_character: selectedSpan.start, end_character: selectedSpan.end, comment: spanComment.trim(), tags: spanTags, linked_reflection_segment_ids: [] }
    updateDraft({ spanComments: [...(draft?.spanComments ?? []), comment] })
    rememberEditor(null, '', [])
    setSpanComment('')
    setSpanTags([])
    setSelectedSpan(null)
  }

  function handleFeedbackSelection(event: React.SyntheticEvent<HTMLTextAreaElement>, component: string, index: number) {
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
    const previous = legacyRatings()
    const records: SavedRating[] = packets.filter(packet => packetState(packet) === 'complete').map(packet => {
      const prior = previous[queueKey(packet, session.evaluator_id)]
      const response = responseForDraft(packet, session.drafts[packet.packet_id])
      return { schema_version: '1.0.0', rating_id: prior?.rating_id ?? crypto.randomUUID(), packet_id: packet.packet_id, task: packet.task, evaluator_type: 'human', evaluator_id: session.evaluator_id, protocol_id: packet.protocol_id, protocol_version: packet.protocol_version, packet_version: packet.packet_version, display_output_sha256: packet.display_output_sha256, displayed_reflection_sha256: packet.displayed_reflection_sha256, submitted_at: prior && canonicalJson(prior.response) === canonicalJson(response) ? prior.submitted_at : new Date().toISOString(), response }
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

  const pendingStarted = pending?.saved.packets.filter(packet => expertCaseState(packet, pending.saved) !== 'not_started').length ?? 0

  return <AppShell workflow="Expert evaluation" context={session ? <><span>{TASK_LABELS[taskFilter]} · {doneCount} / {taskPackets.length} Fälle vollständig</span><label className="annotator-field">Bewertungscode<input value={session.evaluator_id} disabled autoComplete="off" /></label></> : undefined}>
    {error && <div className="rating-error" role="alert">{error}</div>}
    {pending ? <section className="evaluation-start" aria-busy={busy}>
      {pending.conflict ? <div className="start-content"><h1>Unterschiedliche Sitzungsstände</h1><p>Die Datei und der lokal gespeicherte Stand unterscheiden sich.</p><div className="rating-actions"><button className="submit-button" disabled={busy} onClick={() => chooseSession(pending.saved)}>Lokalen Stand fortsetzen</button><button className="icon-button" disabled={busy} onClick={() => chooseSession(pending.incoming)}>Geöffneten Stand verwenden</button><button className="icon-button" disabled={busy} onClick={() => setPending(null)}>Abbrechen</button></div><button className="icon-button" onClick={() => downloadJson('expert-session-local-backup.json', pending.saved)}><Download size={16} />Lokalen Stand sichern</button></div> : <ResumePrompt count={pendingStarted} total={pending.saved.packets.length} onContinue={() => chooseSession(pending.saved)} onRestart={restartSession} onCancel={() => setPending(null)} />}
    </section> : !session ? <main className="evaluation-start" aria-busy={busy}>
      <section className="start-content"><h1>Expertenbewertung</h1><label className="annotator-field start-annotator">Bewertungscode<input value={evaluatorId} onChange={event => { setEvaluatorId(event.target.value); setSavedSessions([]); setError('') }} placeholder="Ihr zugewiesener Code" autoComplete="off" disabled={busy} /></label><PacketFileButton onImport={importPacketFile} primary /><WorkflowHelp />
        {!!savedSessions.length && <section aria-label="Gespeicherte Sitzungen"><h2>Gespeicherte Sitzungen</h2>{savedSessions.map(saved => <button className="icon-button" key={sessionKey(saved)} disabled={busy} onClick={() => void attempt(() => prepareSession(saved, false))}><ChevronRight size={16} />{saved.evaluator_id} · {saved.packets.length} Fälle · {saved.packets.filter(packet => expertCaseState(packet, saved) !== 'not_started').length} begonnen</button>)}</section>}
        <details className="start-storage-actions"><summary>Ältere Forschungsbewertungen</summary><p>{savedForEvaluator.length} gespeicherte Bewertungen</p><button className="icon-button" disabled={!savedForEvaluator.length} onClick={() => downloadJson('ratings-stored.json', { schema_version: '1.0.0', ratings: savedForEvaluator })}><Download size={16} />Forschungsformat exportieren</button></details>
      </section>
    </main> : <>
      <div className="rating-toolbar"><div className="task-tabs" role="tablist" aria-label="Bewertungsaufgabe">{(Object.keys(TASK_LABELS) as RatingTask[]).filter(task => packets.some(packet => packet.task === task)).map(task => <button key={task} role="tab" aria-selected={taskFilter === task} className={taskFilter === task ? 'active' : ''} onClick={() => setSession(current => current ? { ...current, active_task: task, active_index: 0, active_criterion: 0 } : current)}>{TASK_LABELS[task]}</button>)}</div><div className="rating-actions"><button className="icon-button" onClick={() => setExportOpen(true)} disabled={!startedCount}><Download size={16} />Stand exportieren</button><details className="file-management"><summary><FileJson size={18} />Dateien &amp; technische Details</summary><div className="rating-actions"><PacketFileButton onImport={importPacketFile} /><button className="icon-button" disabled={!completeCount} onClick={exportResearch}><Download size={16} />Vollständige Bewertungen im Forschungsformat</button><button className="icon-button" onClick={() => setPending({ incoming: session, saved: session, fingerprint: expectedFingerprint.current, conflict: false })}>Neu beginnen</button><button className="icon-button" onClick={() => { if (persistence !== 'saved' && !window.confirm('Der aktuelle Stand ist noch nicht sicher gespeichert. Trotzdem zur Startseite wechseln?')) return; generation.current += 1; setSession(null); setPersistence('idle'); setError('') }}>Sitzung schließen</button></div><p>Bundle: {session.bundle_sha256}</p>{packet && <dl><dt>Fall-ID</dt><dd>{packet.packet_id}</dd><dt>Paketversion</dt><dd>{packet.packet_version}</dd><dt>Protokoll</dt><dd>{packet.protocol_id} · {packet.protocol_version}</dd><dt>Ausgabe-Prüfsumme</dt><dd>{packet.display_output_sha256 ?? 'Nicht vorhanden'}</dd><dt>Reflexions-Prüfsumme</dt><dd>{packet.displayed_reflection_sha256 ?? 'Nicht vorhanden'}</dd></dl>}</details></div></div>
      <div className="rating-status"><ShieldCheck size={16} /><PersistenceStatus state={persistence} /></div>
      {persistence === 'error' && <div className="rating-actions"><button className="icon-button" onClick={() => setSaveAttempt(value => value + 1)}>Speicherung erneut versuchen</button><button className="icon-button" onClick={inspectSaved}>Gespeicherten Stand prüfen</button><button className="icon-button" onClick={exportSession}><Download size={16} />Aktuellen Stand sichern</button></div>}
      <WorkflowHelp />
      {exportOpen && <ExportSummary total={packets.length} complete={completeCount} started={startedCount - completeCount} onExport={exportSession} onClose={() => setExportOpen(false)} />}
      {packet && draft && <div className="rating-layout"><PacketNavigator label={TASK_LABELS[taskFilter]} states={packetStates} activeIndex={packetIndex} onNavigate={navigatePacket}>
        <details className="protocol-details"><summary>Bewertungsleitfaden</summary><pre>{packet.human_protocol}</pre></details><details className="rubric-details"><summary>Bewertungsraster</summary>{packet.rubric.dimensions.map(dimension => <div className="rubric-dimension" key={dimension.dimension_id}><strong>{dimension.dimension_id} · {dimension.name}</strong><p>{dimension.description}</p><dl>{Object.entries(dimension.bands).map(([band, description]) => <div key={band}><dt>{band}</dt><dd>{description}</dd></div>)}</dl></div>)}</details>
      </PacketNavigator><main className="rating-main"><SourceComparison key={packet.packet_id} packet={packet} onSelection={handleFeedbackSelection}><section className="task-panel" aria-label="Ihre Bewertung"><div className="panel-title"><span>Ihre Bewertung</span></div>
        {packet.task === 'feedback_implied_score' ? <p className="draft-progress">{steps.filter((_, index) => !answerError(packet, draft, index)).length} / {steps.length} Dimensionen vollständig</p> : <RatingProgress packet={packet} draft={draft} activeIndex={criterionIndex} onNavigate={navigateCriterion} />}
        {packet.task !== 'feedback_implied_score' && <p className="criterion-position">Kriterium {criterionIndex + 1} von {steps.length}</p>}
        {packet.task === 'feedback_implied_score' ? <ScoreCoding packet={packet} draft={draft} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={editSpanComment} addSpanComment={addSpanComment} /> : <QualityRating packet={packet} draft={draft} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={editSpanComment} spanTags={spanTags} setSpanTags={editSpanTags} addSpanComment={addSpanComment} />}
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
