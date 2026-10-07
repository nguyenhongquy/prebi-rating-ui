import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowRight, Check, Download, FileJson, Flag, FolderOpen, Link, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { AppShell } from './AppShell'
import PacketNavigator from './PacketNavigator'
import { ComparisonWorkspace, EvidenceReferences, FeedbackHeading, ReflectionViewer, scrollToEvidence } from './SourceComparison'
import { componentLabels } from './ratingTypes'
import { canonicalJson, type CaseState } from './ratingValidation'
import { approveReview, editReviewDraft, initialReviewDraft, REVIEW_COMPONENTS, REVIEW_SCHEMA, reviewIsCurrent, sameReviewValue, type ReviewComponent, type ReviewDecision, type ReviewDraft, type ReviewFeedback } from './reviewContract'
import { createReviewSession, feedbackCount, packetDraftItems, parseReviewSession, reviewCaseState, sessionKey, visitReviewPacket, type ReviewAnnotation, type ReviewSession } from './reviewSession'
import { readSession, writeSession, listSessions } from './localSessions'
import { WorkflowHelp, ResumePrompt, ExportSummary, PersistenceStatus } from './WorkflowSupport'
import './RatingWorkbench.css'
import './ReviewWorkbench.css'

const STORAGE_KEY = 'prebi-lecturer-review-v1'
const REVIEWER_KEY = 'prebi-lecturer-reviewer-v1'
const decisionLabels: Record<ReviewDecision, string> = { use_as_generated: 'Unverändert verwenden', use_with_edits: 'Mit Änderungen verwenden', do_not_use: 'Nicht verwenden' }

function downloadReview(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function legacySessions(code: string): ReviewSession[] {
  const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Der ältere lokale Prüfungsstand konnte nicht gelesen werden.')
  return Object.entries(value).filter(([key]) => key.startsWith(`${code}::`)).map(([, bundle]) => parseReviewSession(bundle, code))
}

function savedReviewer(): string {
  try { return localStorage.getItem(REVIEWER_KEY) ?? '' }
  catch { return '' }
}

export default function ReviewWorkbench() {
  const [reviewer, setReviewer] = useState(savedReviewer)
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [persistence, setPersistence] = useState<'saving' | 'saved' | 'error' | 'idle'>('idle')
  const [pendingResume, setPendingResume] = useState<{ local: ReviewSession; uploaded?: ReviewSession } | null>(null)
  const [localEntries, setLocalEntries] = useState<ReviewSession[]>([])
  const [showLocalEntries, setShowLocalEntries] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const sessionRef = useRef<ReviewSession | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const saveRevision = useRef(0)
  const openRevision = useRef(0)
  const expectedFingerprint = useRef<string | undefined>(undefined)
  const bundle = session?.bundle ?? null
  const packetIndex = session?.activeIndex ?? 0
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [status, setStatus] = useState('')
  const [reviewComplete, setReviewComplete] = useState(false)
  const [activeItem, setActiveItem] = useState<{ component: ReviewComponent; id: string } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [shownIds, setShownIds] = useState<string[]>([])
  const [selectedOriginal, setSelectedOriginal] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const packet = bundle?.packets[packetIndex]
  const progress = bundle?.progress
  const approval = packet ? progress?.approvals[packet.review_packet_id] : undefined
  const draft = packet ? progress?.drafts[packet.review_packet_id] ?? (approval ? { feedback: approval.feedback, decision: approval.decision, first_edited_at: approval.first_edited_at, updated_at: approval.approved_at } : initialReviewDraft(packet, new Date().toISOString())) : null
  const states: CaseState[] = session ? session.bundle.packets.map(item => reviewCaseState(session, item)) : []
  const completeCount = states.filter(state => state === 'complete').length
  const allComplete = Boolean(bundle && completeCount === bundle.packets.length)
  const activeFeedbackItem = activeItem && draft?.feedback[activeItem.component].find(item => item.item_id === activeItem.id)
  const activeLabel = activeItem ? `${componentLabels[activeItem.component]} ${(draft?.feedback[activeItem.component].findIndex(item => item.item_id === activeItem.id) ?? -1) + 1}` : ''
  const annotations = packet && session?.annotations[packet.review_packet_id] || {}
  const seenCount = session?.seen_packet_ids.length ?? 0
  const annotationCount = completeCount
  const startedCount = session ? session.bundle.packets.filter(item => session.seen_packet_ids.includes(item.review_packet_id) || progress?.drafts[item.review_packet_id] || progress?.approvals[item.review_packet_id] || Object.keys(session.annotations[item.review_packet_id] ?? {}).length).length : 0

  useEffect(() => {
    const code = savedReviewer().trim()
    if (!code) return
    const revision = openRevision.current
    let cancelled = false
    loadLocalSessions(code).then(entries => {
      if (cancelled || sessionRef.current || revision !== openRevision.current) return
      setLocalEntries(entries)
      if (entries.length === 1) setPendingResume({ local: entries[0] })
      else if (entries.length) setShowLocalEntries(true)
    }).catch(caught => { if (!cancelled && revision === openRevision.current) setError(caught instanceof Error ? caught.message : 'Lokale Prüfungsstände konnten nicht gelesen werden.') })
    return () => { cancelled = true }
  }, [])

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
    setPreviewId(null)
    setShownIds([])
    setSelectedOriginal(null)
    setError('')
    const first = packet && REVIEW_COMPONENTS.flatMap(component => (draft?.feedback[component] ?? []).map(item => ({ component, id: item.item_id })))[0]
    setActiveItem(first ?? null)
  }, [packet?.review_packet_id, bundle?.bundle_id])

  function persist(next: ReviewSession) {
    sessionRef.current = next
    setSession(next)
    const revision = ++saveRevision.current
    setPersistence('saving')
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const save = async () => {
        const previous = await readSession<unknown>(sessionKey(next))
        if ((previous === undefined ? undefined : canonicalJson(previous)) !== expectedFingerprint.current) throw new Error('Dieser Prüfungsstand wurde in einem anderen Fenster geändert. Öffnen Sie den lokalen Stand erneut oder exportieren Sie Ihre Änderungen.')
        await writeSession(sessionKey(next), next)
        expectedFingerprint.current = canonicalJson(next)
      }
      if (navigator.locks) await navigator.locks.request(`prebi:${sessionKey(next)}`, save)
      else throw new Error('Dieser Browser unterstützt keine sichere tabübergreifende Speicherung.')
      if (revision === saveRevision.current) { setPersistence('saved'); setStorageError('') }
    }).catch(caught => {
      if (revision === saveRevision.current) {
        setPersistence('error')
        setStorageError(caught instanceof Error ? caught.message : 'Der Prüfungsstand konnte nicht lokal gespeichert werden. Exportieren Sie Ihre Arbeit, bevor Sie diese Seite verlassen.')
      }
    })
  }

  function changeReviewer(value: string) {
    setReviewer(value)
    try { localStorage.setItem(REVIEWER_KEY, value) }
    catch { setStorageError('Der Prüfungscode konnte nicht lokal gespeichert werden.'); setPersistence('error') }
    setLocalEntries([])
    setShowLocalEntries(false)
    setPendingResume(null)
    openRevision.current++
  }

  async function loadLocalSessions(code: string): Promise<ReviewSession[]> {
    await saveQueue.current
    const entries = await listSessions<unknown>(`review::${code}::`)
    const sessions = entries.map((entry: { key: string; value: unknown }) => {
      const value = parseReviewSession(entry.value, code)
      if (sessionKey(value) !== entry.key || value.bundle.progress?.reviewer_id !== code) throw new Error('Ein lokaler Prüfungsstand enthält widersprüchliche Kennungen.')
      return value
    })
    const keys = new Set(sessions.map(sessionKey))
    return [...sessions, ...legacySessions(code).filter(value => !keys.has(sessionKey(value)))]
  }

  async function activate(next: ReviewSession, fingerprint: string | undefined = undefined) {
    try { await activateSession(next, fingerprint) }
    catch (caught) {
      setPersistence('error')
      setStorageError(caught instanceof Error ? caught.message : 'Der lokale Prüfungsstand konnte nicht geöffnet werden.')
    }
  }

  async function activateSession(next: ReviewSession, fingerprint: string | undefined) {
    await saveQueue.current
    const existing = await readSession<unknown>(sessionKey(next))
    const actual = existing === undefined ? undefined : canonicalJson(existing)
    const legacyMatch = existing === undefined && fingerprint !== undefined && legacySessions(next.bundle.progress!.reviewer_id).some(value => sessionKey(value) === sessionKey(next) && canonicalJson(value) === fingerprint)
    if (actual !== fingerprint && !legacyMatch) {
      if (existing !== undefined) setPendingResume({ local: parseReviewSession(existing), uploaded: next })
      setError('Der lokale Prüfungsstand wurde inzwischen geändert. Bitte wählen Sie den gewünschten Stand erneut.')
      return
    }
    expectedFingerprint.current = actual
    openRevision.current++
    const code = next.bundle.progress!.reviewer_id
    setReviewer(code)
    try { localStorage.setItem(REVIEWER_KEY, code) }
    catch { setStorageError('Der Prüfungscode konnte nicht lokal gespeichert werden.') }
    setActiveItem(null)
    setPreviewId(null)
    setReviewComplete(false)
    setPendingResume(null)
    setShowLocalEntries(false)
    setError('')
    setStatus('Prüfungspaket geöffnet.')
    persist(visitReviewPacket(next, next.activeIndex))
  }

  async function openBundle(value: unknown) {
    const revision = ++openRevision.current
    const uploaded = parseReviewSession(value, reviewer)
    const code = uploaded.bundle.progress!.reviewer_id
    if (reviewer.trim() && reviewer.trim() !== code) throw new Error('Diese Datei gehört zu einem anderen Prüfungscode. Schließen Sie das Paket und geben Sie den zugehörigen Prüfungscode ein.')
    await saveQueue.current
    const key = sessionKey(uploaded)
    const localValue = await readSession<unknown>(key)
    const local = localValue === undefined ? legacySessions(code).find(entry => sessionKey(entry) === key) : parseReviewSession(localValue, code)
    if (revision !== openRevision.current) return
    if (local && sessionKey(local) !== key) throw new Error('Der lokale Prüfungsstand enthält widersprüchliche Kennungen.')
    if (local && !sameReviewValue(local.bundle.packets, uploaded.bundle.packets)) throw new Error('Unter dieser Paketkennung sind bereits andere Ausgangsdaten gespeichert. Verwenden Sie eine neue Paketkennung.')
    if (local) { setPendingResume({ local, uploaded }); return }
    await activate(uploaded)
  }

  async function showLocalSessions() {
    if (!reviewer.trim()) { setError('Geben Sie Ihren Prüfungscode ein.'); return }
    const revision = ++openRevision.current
    try {
      const entries = await loadLocalSessions(reviewer.trim())
      if (revision !== openRevision.current) return
      setLocalEntries(entries)
      setShowLocalEntries(true)
      setError(entries.length ? '' : 'Für diesen Code sind keine Prüfungsstände gespeichert.')
    } catch (caught) { if (revision === openRevision.current) setError(caught instanceof Error ? caught.message : 'Lokale Prüfungsstände konnten nicht gelesen werden.') }
  }

  function restartSession() {
    if (!pendingResume || !window.confirm('Neu beginnen und den lokalen Prüfungsstand ersetzen? Exportieren Sie ihn zuerst, um ihn zu behalten.')) return
    const source = pendingResume.uploaded ?? pendingResume.local
    const { progress: previousProgress, ...original } = source.bundle
    void activate(createReviewSession(original, previousProgress!.reviewer_id), canonicalJson(pendingResume.local))
  }

  function useUploadedSession() {
    if (!pendingResume?.uploaded || !window.confirm('Den lokalen Prüfungsstand durch die hochgeladene Datei ersetzen? Die beiden Stände werden nicht zusammengeführt.')) return
    void activate(pendingResume.uploaded, canonicalJson(pendingResume.local))
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try { await openBundle(JSON.parse(await file.text())) }
    catch (caught) { setError(caught instanceof SyntaxError ? 'Die Datei enthält kein gültiges JSON.' : caught instanceof Error ? caught.message : 'Das Prüfungspaket konnte nicht geöffnet werden.') }
  }

  async function openSynthetic() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`)
      if (!response.ok) throw new Error('Das synthetische Beispiel konnte nicht geladen werden.')
      await openBundle(await response.json())
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Das synthetische Beispiel konnte nicht geöffnet werden.') }
  }

  function updateDraft(nextDraft: ReviewDraft) {
    const current = sessionRef.current
    if (!current || !packet || !current.bundle.progress) return
    const nextProgress = { ...current.bundle.progress, drafts: { ...current.bundle.progress.drafts, [packet.review_packet_id]: nextDraft } }
    const next = { ...current, bundle: { ...current.bundle, progress: nextProgress } }
    const validIds = new Set([...packetDraftItems(next, packet), ...REVIEW_COMPONENTS.flatMap(component => packet.generated_feedback[component].map(item => item.item_id)), ...REVIEW_COMPONENTS.flatMap(component => nextProgress.approvals[packet.review_packet_id]?.feedback[component].map(item => item.item_id) ?? [])])
    next.annotations = { ...next.annotations, [packet.review_packet_id]: Object.fromEntries(Object.entries(next.annotations[packet.review_packet_id] ?? {}).filter(([id]) => validIds.has(id))) }
    persist(next)
    setError('')
    setStatus('Entwurf aktualisiert.')
  }

  function editFeedback(feedback: ReviewFeedback) {
    if (draft) updateDraft(editReviewDraft(draft, feedback, new Date().toISOString()))
  }

  function annotate(itemId: string, patch: Partial<ReviewAnnotation>) {
    const current = sessionRef.current
    if (!current || !packet) return
    const items = current.annotations[packet.review_packet_id] ?? {}
    const annotation = { ...items[itemId], ...patch, status: patch.status ?? items[itemId]?.status ?? 'problem' }
    const next = { ...current, annotations: { ...current.annotations, [packet.review_packet_id]: { ...items, [itemId]: annotation } } }
    persist(next)
  }

  function navigate(index: number) {
    const current = sessionRef.current
    if (!current) return
    persist(visitReviewPacket(current, index))
    setError('')
    setPreviewId(null)
    setReviewComplete(false)
  }

  function nextPacket() {
    if (packetIndex + 1 < (bundle?.packets.length ?? 0)) navigate(packetIndex + 1)
    else setExportOpen(true)
  }

  function toggleEvidence(id: string) {
    if (!draft || !activeItem || !activeFeedbackItem || !packet) return
    const ids = activeFeedbackItem.evidence_segment_ids.includes(id) ? activeFeedbackItem.evidence_segment_ids.filter(value => value !== id) : [...activeFeedbackItem.evidence_segment_ids, id]
    const ordered = packet.reflection.segments.filter(segment => ids.includes(segment.segment_id)).map(segment => segment.segment_id)
    editFeedback({ ...draft.feedback, [activeItem.component]: draft.feedback[activeItem.component].map(item => item.item_id === activeItem.id ? { ...item, evidence_segment_ids: ordered } : item) })
  }

  function highlightEvidence(id: string) {
    setPreviewId(id)
    scrollToEvidence(scrollRef.current, id)
  }

  function showEvidence(ids: string[], item: { component: ReviewComponent; id: string } | null, originalId: string | null = null) {
    setActiveItem(item)
    setSelectedOriginal(originalId)
    setShownIds(item ? [] : ids)
    setPreviewId(null)
    if (ids[0]) scrollToEvidence(scrollRef.current, ids[0])
  }

  function approve() {
    if (!packet || !bundle || !progress || !draft) return
    try {
      const nextApproval = approveReview(packet, draft, new Date().toISOString())
      const nextProgress = { ...progress, drafts: { ...progress.drafts, [packet.review_packet_id]: draft }, approvals: { ...progress.approvals, [packet.review_packet_id]: nextApproval } }
      if (!sessionRef.current) return
      persist({ ...sessionRef.current, bundle: { ...bundle, progress: nextProgress } })
      setError('')
      setStatus('Prüfentscheidung übernommen. Es wurde kein Feedback versendet.')
      let nextIndex = -1
      for (let offset = 1; offset < bundle.packets.length; offset++) {
        const index = (packetIndex + offset) % bundle.packets.length
        const item = bundle.packets[index]
        if (!reviewIsCurrent(nextProgress.drafts[item.review_packet_id], nextProgress.approvals[item.review_packet_id])) { nextIndex = index; break }
      }
      if (nextIndex === -1) setReviewComplete(true)
      else navigate(nextIndex)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Die Prüfentscheidung konnte nicht gespeichert werden.') }
  }

  function exportProgress() {
    if (sessionRef.current) downloadReview('prebi-lecturer-session.json', sessionRef.current)
    setExportOpen(false)
  }

  async function exportStored() {
    if (!reviewer.trim()) { setError('Geben Sie Ihren Prüfungscode ein.'); return }
    try {
      const entries = await loadLocalSessions(reviewer.trim())
      if (!entries.length) { setError('Für diesen Code sind keine Prüfungspakete gespeichert.'); return }
      for (const value of entries) downloadReview(`prebi-lecturer-session-${encodeURIComponent(value.bundle.bundle_id)}.json`, value)
    } catch { setError('Der gespeicherte Prüfungsstand konnte nicht gelesen werden.') }
  }

  const evidence = { selectedId: previewId, selectedIds: activeFeedbackItem?.evidence_segment_ids ?? shownIds, onPreview: setPreviewId, onActivate: highlightEvidence }

  return <AppShell workflow="Lecturer review" context={bundle ? <><span>{seenCount} / {bundle.packets.length} gesehen</span><span>{annotationCount} Rückmeldungen</span><span>Prüfungscode: {reviewer}</span></> : undefined}>
    <input ref={fileRef} type="file" className="packet-file-input" accept="application/json,.json" aria-label="Prüfungspaket als JSON-Datei" onChange={importFile} />
    {storageError && <p className="rating-error" role="alert">{storageError}</p>}
    {pendingResume && <>
      <ResumePrompt count={pendingResume.local.seen_packet_ids.length} total={pendingResume.local.bundle.packets.length} onContinue={() => void activate(pendingResume.local, canonicalJson(pendingResume.local))} onRestart={restartSession} onCancel={() => setPendingResume(null)} review />
      <div className="review-resume-options" aria-label="Weitere Optionen zum Prüfungsstand">
        <button className="icon-button" onClick={() => downloadReview('prebi-lecturer-session-local.json', pendingResume.local)}><Download size={18} />Lokalen Stand exportieren</button>
        {pendingResume.uploaded && <button className="icon-button" onClick={useUploadedSession}><Upload size={18} />Hochgeladenen Stand verwenden</button>}
      </div>
    </>}
    {exportOpen && bundle && <ExportSummary total={bundle.packets.length} complete={completeCount} started={startedCount} feedback={annotationCount} onExport={exportProgress} onClose={() => setExportOpen(false)} review />}
    {!bundle ? <main className="evaluation-start"><section className="start-content">
      <h1>Feedbackprüfung</h1>
      <WorkflowHelp review />
      <label className="annotator-field start-annotator">Prüfungscode<input value={reviewer} onChange={event => changeReviewer(event.target.value)} placeholder="Ihr zugewiesener Code" autoComplete="off" /></label>
      {error && <p className="rating-error" role="alert">{error}</p>}
      <div className="review-start-actions"><button className="submit-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Prüfungspaket öffnen</button><button className="icon-button" onClick={showLocalSessions}><FolderOpen size={18} />Lokale Prüfungsstände</button><button className="icon-button" onClick={openSynthetic}><FileJson size={18} />Synthetisches Beispiel öffnen</button></div>
      {showLocalEntries && <ul className="review-local-sessions" aria-label="Lokal gespeicherte Prüfungsstände">{localEntries.map(value => <li key={sessionKey(value)}><button className="icon-button" onClick={() => setPendingResume({ local: value })}><FolderOpen size={18} /><span>{value.bundle.bundle_id}<small>{value.seen_packet_ids.length} / {value.bundle.packets.length} gesehen · {feedbackCount(value)} Rückmeldungen</small></span></button></li>)}</ul>}
      <p className="local-storage-note">Entwürfe und Freigaben werden lokal in diesem Browser gespeichert.</p>
      <details className="start-storage-actions"><summary>Prüfungsdateien</summary><div className="review-start-actions"><button className="icon-button" onClick={exportStored}><Download size={18} />Prüfungsstand exportieren</button><button className="icon-button" onClick={() => downloadReview('prebi-review-bundle.schema.json', REVIEW_SCHEMA)}><Download size={18} />Prüfungsschema herunterladen</button><a href={`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`} download>Synthetisches Paket herunterladen</a></div></details>
    </section></main> : <>
      <div className="rating-toolbar"><span>Feedbackprüfung durch Lehrende</span><div className="rating-actions"><button className="icon-button" onClick={() => setExportOpen(true)}><Download size={18} />Prüfungsstand exportieren</button><button className="icon-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Prüfungspaket öffnen</button><button className="icon-button" onClick={() => { if (persistence === 'error' && !window.confirm('Der Prüfungsstand ist nicht lokal gesichert. Trotzdem schließen?')) return; sessionRef.current = null; setSession(null); setError(''); setActiveItem(null); setPendingResume(null); setExportOpen(false); openRevision.current++ }}><X size={18} />Paket schließen</button></div></div>
      <div className="review-status"><span role="status">{status}</span><PersistenceStatus state={persistence} /><WorkflowHelp review /></div>
      {allComplete && reviewComplete ? <main className="evaluation-complete"><section className="completion-content"><h1>Prüfung abgeschlossen</h1><ul className="completion-checks"><li><Check size={22} />{completeCount} / {bundle.packets.length} Prüfentscheidungen erfasst</li></ul><div className="completion-actions"><button className="submit-button" onClick={exportProgress}><Download size={18} />Geprüftes Paket exportieren</button><button className="icon-button" onClick={() => setReviewComplete(false)}><RotateCcw size={18} />Prüfentscheidungen ansehen</button></div><p>Es wurde kein Feedback an Studierende versendet.</p></section></main> : packet && draft ? <div className="rating-layout">
        <PacketNavigator review label="Feedbackprüfung" states={states} activeIndex={packetIndex} onNavigate={navigate}><p className="review-packet-state">{seenCount} / {bundle.packets.length} gesehen<br />{annotationCount} Rückmeldungen</p></PacketNavigator>
        <main className="rating-main review-main">
          <ComparisonWorkspace reflection={<ReflectionViewer segments={packet.reflection.segments} activeId={previewId} activeIds={shownIds} scrollRef={scrollRef} evidenceSelection={activeFeedbackItem ? { ids: activeFeedbackItem.evidence_segment_ids, onToggle: toggleEvidence, label: activeLabel } : undefined} />}>
            <section className="source-panel review-feedback" aria-label="Feedbackentwurf"><div className="panel-title"><h2>Feedbackentwurf</h2></div><div className="source-scroll">
              <details className="original-feedback"><summary>Ursprüngliches generiertes Feedback</summary>{REVIEW_COMPONENTS.map(component => <section key={component}><FeedbackHeading component={component} />{packet.generated_feedback[component].map(item => <article className={selectedOriginal === item.item_id ? 'selected-feedback' : ''} key={item.item_id}><p>{item.text}</p><EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => showEvidence(item.evidence_segment_ids, null, item.item_id)} onActivate={id => { showEvidence(item.evidence_segment_ids, null, item.item_id); highlightEvidence(id) }} /></article>)}</section>)}</details>
              {REVIEW_COMPONENTS.map(component => <section className="feedback-editor-section" key={component}><FeedbackHeading component={component} />{draft.feedback[component].map((item, index) => <article key={item.item_id} className={activeItem?.id === item.item_id ? 'editing-item' : ''}>
                <div className="review-item-verdict" role="group" aria-label={`${componentLabels[component]} ${index + 1} beurteilen`}>
                  <button className={`icon-button ${annotations[item.item_id]?.status === 'appropriate' ? 'review-verdict-selected appropriate' : ''}`} aria-pressed={annotations[item.item_id]?.status === 'appropriate'} onClick={() => annotate(item.item_id, { status: 'appropriate' })}><Check size={17} />Passt</button>
                  <button className={`icon-button ${annotations[item.item_id]?.status === 'problem' ? 'review-verdict-selected problem' : ''}`} aria-pressed={annotations[item.item_id]?.status === 'problem'} onClick={() => annotate(item.item_id, { status: 'problem' })}><Flag size={17} />Problem markieren</button>
                </div>
                <label className="review-field">{componentLabels[component]} {index + 1}<textarea rows={3} value={item.text} onFocus={() => { setActiveItem({ component, id: item.item_id }); setShownIds([]); setSelectedOriginal(null) }} onChange={event => editFeedback({ ...draft.feedback, [component]: draft.feedback[component].map(value => value.item_id === item.item_id ? { ...value, text: event.target.value } : value) })} /></label>
                <details className="review-item-notes"><summary>Kommentar / Alternative (optional)</summary>
                  <label className="review-field">Kommentar<textarea rows={2} value={annotations[item.item_id]?.comment ?? ''} onChange={event => annotate(item.item_id, { comment: event.target.value })} /></label>
                  <label className="review-field">Alternative<textarea rows={2} value={annotations[item.item_id]?.alternative ?? ''} onChange={event => annotate(item.item_id, { alternative: event.target.value })} /></label>
                </details>
                <EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => showEvidence(item.evidence_segment_ids, { component, id: item.item_id })} onActivate={id => { showEvidence(item.evidence_segment_ids, { component, id: item.item_id }); highlightEvidence(id) }} />
                <div className="review-item-actions"><button className="icon-button" aria-pressed={activeItem?.id === item.item_id} onClick={() => showEvidence(item.evidence_segment_ids, { component, id: item.item_id })}><Link size={16} />Belege bearbeiten</button><button className="icon-button danger" aria-label={`${componentLabels[component]} ${index + 1} entfernen`} title="Feedbackeintrag entfernen" onClick={() => { editFeedback({ ...draft.feedback, [component]: draft.feedback[component].filter(value => value.item_id !== item.item_id) }); if (activeItem?.id === item.item_id) setActiveItem(null) }}><Trash2 size={16} /></button></div>
              </article>)}<button className="icon-button" onClick={() => { const item = { item_id: crypto.randomUUID(), text: '', evidence_segment_ids: [] }; editFeedback({ ...draft.feedback, [component]: [...draft.feedback[component], item] }); setActiveItem({ component, id: item.item_id }) }}><Plus size={16} />Eintrag hinzufügen</button></section>)}
            </div></section>
          <section className="review-task-panel" aria-label="Prüfentscheidung">
            {error && <p className="rating-error" role="alert">{error}</p>}
            <details className="review-advanced"><summary>Freigabe und technische Details</summary>
            {approval && <p className={reviewIsCurrent(draft ?? undefined, approval) ? 'submission-note' : 'submission-note pending'}>{reviewIsCurrent(draft ?? undefined, approval) ? `Freigegeben: ${decisionLabels[approval.decision]}` : 'Änderungen noch nicht freigegeben'}</p>}
            <fieldset className="review-decisions"><legend>Prüfentscheidung</legend>{(Object.keys(decisionLabels) as ReviewDecision[]).map(decision => <label key={decision}><input type="radio" name="review-decision" value={decision} checked={draft.decision === decision} onChange={() => updateDraft({ ...draft, decision, updated_at: new Date().toISOString() })} />{decisionLabels[decision]}</label>)}</fieldset>
            <details className="review-timing"><summary>Technische Details</summary><dl><dt>Paket-ID</dt><dd>{packet.review_packet_id}</dd><dt>Erste Feedbackänderung</dt><dd>{draft.first_edited_at ?? 'Noch nicht bearbeitet'}</dd><dt>Letzte Freigabe</dt><dd>{approval?.approved_at ?? 'Noch nicht freigegeben'}</dd><dt>Zeit von der ersten Änderung bis zur Freigabe</dt><dd>{approval?.editing_to_approval_ms == null ? 'Nicht verfügbar' : `${(approval.editing_to_approval_ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Sekunden (einschließlich Pausen)`}</dd></dl></details>
            <div className="review-approve-actions"><button className="icon-button" onClick={() => { if (window.confirm('Generiertes Feedback wiederherstellen? Der Zeitpunkt der ersten Änderung bleibt erhalten.')) { const next = editReviewDraft(draft, structuredClone(packet.generated_feedback), new Date().toISOString()); updateDraft({ ...next, decision: 'use_as_generated' }); setActiveItem(null); setShownIds([]) } }}><RotateCcw size={18} />Generiertes Feedback wiederherstellen</button><button className="submit-button" onClick={approve}><Check size={18} />Speichern &amp; weiter</button>{allComplete && <button className="icon-button" onClick={() => setReviewComplete(true)}>Abschlussübersicht anzeigen</button>}</div>
            </details>
            <footer className="review-next-actions"><span>Fall {packetIndex + 1} / {bundle.packets.length}</span><button className="submit-button" onClick={nextPacket}>Nächster Fall<ArrowRight size={18} /></button></footer>
          </section>
          </ComparisonWorkspace>
        </main>
      </div> : null}
    </>}
  </AppShell>
}