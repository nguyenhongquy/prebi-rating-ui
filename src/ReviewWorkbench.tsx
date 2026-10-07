import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Check, Download, FileJson, Link, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { AppShell } from './AppShell'
import PacketNavigator from './PacketNavigator'
import { ComparisonWorkspace, EvidenceReferences, FeedbackHeading, ReflectionViewer, scrollToEvidence } from './SourceComparison'
import { componentLabels } from './ratingTypes'
import { approveReview, editReviewDraft, initialReviewDraft, parseReviewBundle, REVIEW_COMPONENTS, REVIEW_SCHEMA, reviewIsCurrent, sameReviewValue, type ReviewBundle, type ReviewComponent, type ReviewDecision, type ReviewDraft, type ReviewFeedback, type ReviewProgress } from './reviewContract'
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

function storedBundles(): Record<string, ReviewBundle> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}

export default function ReviewWorkbench() {
  const [reviewer, setReviewer] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? '')
  const [bundle, setBundle] = useState<ReviewBundle | null>(null)
  const [packetIndex, setPacketIndex] = useState(0)
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
  const states = bundle?.packets.map(item => reviewIsCurrent(progress?.drafts[item.review_packet_id], progress?.approvals[item.review_packet_id]) ? 'submitted' as const : progress?.approvals[item.review_packet_id] ? 'changed' as const : progress?.drafts[item.review_packet_id] ? 'draft' as const : 'not_started' as const) ?? []
  const completeCount = states.filter(state => state === 'submitted').length
  const allComplete = Boolean(bundle && completeCount === bundle.packets.length)
  const activeFeedbackItem = activeItem && draft?.feedback[activeItem.component].find(item => item.item_id === activeItem.id)
  const activeLabel = activeItem ? `${componentLabels[activeItem.component]} ${(draft?.feedback[activeItem.component].findIndex(item => item.item_id === activeItem.id) ?? -1) + 1}` : ''

  useEffect(() => {
    setPreviewId(null)
    setShownIds([])
    setSelectedOriginal(null)
    setError('')
    const first = packet && REVIEW_COMPONENTS.flatMap(component => (draft?.feedback[component] ?? []).map(item => ({ component, id: item.item_id })))[0]
    setActiveItem(first ?? null)
  }, [packet?.review_packet_id, bundle?.bundle_id])

  function persist(next: ReviewBundle) {
    setBundle(next)
    try {
      const stored = storedBundles()
      stored[`${next.progress!.reviewer_id}::${next.bundle_id}`] = next
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      localStorage.setItem(REVIEWER_KEY, next.progress!.reviewer_id)
      setStorageError('')
    } catch {
      setStorageError('Der Browserspeicher ist nicht verfügbar oder voll. Exportieren Sie den Prüfungsstand, bevor Sie diese Seite verlassen.')
    }
  }

  function changeReviewer(value: string) {
    setReviewer(value)
    try { localStorage.setItem(REVIEWER_KEY, value) }
    catch { setStorageError('Der Prüfungscode konnte nicht lokal gespeichert werden.') }
  }

  function openBundle(value: unknown) {
    let loaded = parseReviewBundle(value)
    const code = loaded.progress?.reviewer_id.trim() || reviewer.trim()
    if (!code) throw new Error('Geben Sie Ihren Prüfungscode ein, bevor Sie ein Prüfungspaket öffnen.')
    if (loaded.progress && reviewer.trim() && reviewer.trim() !== code) throw new Error('Diese Datei gehört zu einem anderen Prüfungscode. Schließen Sie das Paket und geben Sie den zugehörigen Prüfungscode ein.')
    const localValue = storedBundles()[`${code}::${loaded.bundle_id}`]
    let local: ReviewBundle | null = null
    if (localValue) local = parseReviewBundle(localValue)
    if (local && !sameReviewValue(local.packets, loaded.packets)) throw new Error('Unter dieser Paketkennung sind bereits andere Ausgangsdaten gespeichert. Verwenden Sie eine neue Paketkennung.')
    if (local && loaded.progress && !sameReviewValue(local.progress, loaded.progress)) {
      if (!window.confirm('Den lokal gespeicherten Prüfungsstand durch die hochgeladene Datei ersetzen? Exportieren Sie zuerst den lokalen Stand, wenn Sie beide Versionen behalten möchten.')) return
    } else if (local && !loaded.progress) loaded = local
    const nextProgress: ReviewProgress = loaded.progress ?? { reviewer_id: code, drafts: {}, approvals: {} }
    loaded = { ...loaded, progress: nextProgress }
    const nextIndex = loaded.packets.findIndex(item => !reviewIsCurrent(nextProgress.drafts[item.review_packet_id], nextProgress.approvals[item.review_packet_id]))
    setReviewer(code)
    setPacketIndex(Math.max(0, nextIndex))
    setActiveItem(null)
    setPreviewId(null)
    setReviewComplete(nextIndex === -1)
    setError('')
    setStatus('Prüfungspaket geöffnet. Das ursprüngliche Feedback bleibt erhalten.')
    persist(loaded)
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try { openBundle(JSON.parse(await file.text())) }
    catch (caught) { setError(caught instanceof SyntaxError ? 'Die Datei enthält kein gültiges JSON.' : caught instanceof Error ? caught.message : 'Das Prüfungspaket konnte nicht geöffnet werden.') }
  }

  async function openSynthetic() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`)
      if (!response.ok) throw new Error('Das synthetische Beispiel konnte nicht geladen werden.')
      openBundle(await response.json())
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Das synthetische Beispiel konnte nicht geöffnet werden.') }
  }

  function updateDraft(nextDraft: ReviewDraft) {
    if (!bundle || !packet || !progress) return
    persist({ ...bundle, progress: { ...progress, drafts: { ...progress.drafts, [packet.review_packet_id]: nextDraft } } })
    setError('')
    setStatus('Entwurf aktualisiert.')
  }

  function editFeedback(feedback: ReviewFeedback) {
    if (draft) updateDraft(editReviewDraft(draft, feedback, new Date().toISOString()))
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
      persist({ ...bundle, progress: nextProgress })
      setError('')
      setStatus('Prüfentscheidung lokal gespeichert. Es wurde kein Feedback versendet.')
      let nextIndex = -1
      for (let offset = 1; offset < bundle.packets.length; offset++) {
        const index = (packetIndex + offset) % bundle.packets.length
        const item = bundle.packets[index]
        if (!reviewIsCurrent(nextProgress.drafts[item.review_packet_id], nextProgress.approvals[item.review_packet_id])) { nextIndex = index; break }
      }
      if (nextIndex === -1) setReviewComplete(true)
      else setPacketIndex(nextIndex)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Die Prüfentscheidung konnte nicht gespeichert werden.') }
  }

  function exportProgress() {
    if (bundle) downloadReview('prebi-review-progress.json', bundle)
  }

  function exportStored() {
    if (!reviewer.trim()) { setError('Geben Sie Ihren Prüfungscode ein.'); return }
    try {
      const entries = Object.values(storedBundles()).filter(value => value.progress?.reviewer_id === reviewer.trim())
      if (!entries.length) { setError('Für diesen Code sind keine Prüfungspakete gespeichert.'); return }
      for (const value of entries) downloadReview('prebi-review-progress.json', parseReviewBundle(value))
    } catch { setError('Der gespeicherte Prüfungsstand konnte nicht gelesen werden.') }
  }

  const evidence = { selectedId: previewId, selectedIds: activeFeedbackItem?.evidence_segment_ids ?? shownIds, onPreview: setPreviewId, onActivate: highlightEvidence }

  return <AppShell workflow="Lecturer review" context={bundle ? <><span>{completeCount} / {bundle.packets.length} aktuelle Freigaben</span><span>Prüfungscode: {reviewer}</span></> : undefined}>
    <input ref={fileRef} type="file" className="packet-file-input" accept="application/json,.json" aria-label="Prüfungspaket als JSON-Datei" onChange={importFile} />
    {storageError && <p className="rating-error" role="alert">{storageError}</p>}
    {!bundle ? <main className="evaluation-start"><section className="start-content">
      <h1>Feedbackprüfung</h1>
      <label className="annotator-field start-annotator">Prüfungscode<input value={reviewer} onChange={event => changeReviewer(event.target.value)} placeholder="Ihr zugewiesener Code" autoComplete="off" /></label>
      {error && <p className="rating-error" role="alert">{error}</p>}
      <div className="review-start-actions"><button className="submit-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Prüfungspaket öffnen</button><button className="icon-button" onClick={openSynthetic}><FileJson size={18} />Synthetisches Beispiel öffnen</button></div>
      <p className="local-storage-note">Entwürfe und Freigaben werden lokal in diesem Browser gespeichert.</p>
      <details className="start-storage-actions"><summary>Prüfungsdateien</summary><div className="review-start-actions"><button className="icon-button" onClick={exportStored}><Download size={18} />Prüfungsstand exportieren</button><button className="icon-button" onClick={() => downloadReview('prebi-review-bundle.schema.json', REVIEW_SCHEMA)}><Download size={18} />Prüfungsschema herunterladen</button><a href={`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`} download>Synthetisches Paket herunterladen</a></div></details>
    </section></main> : <>
      <div className="rating-toolbar"><span>Feedbackprüfung durch Lehrende</span><div className="rating-actions"><button className="icon-button" onClick={exportProgress}><Download size={18} />Prüfungsstand exportieren</button><button className="icon-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Prüfungspaket öffnen</button><button className="icon-button" onClick={() => { setBundle(null); setError(''); setActiveItem(null) }}><X size={18} />Paket schließen</button></div></div>
      <p className="review-status" role="status">{status} {storageError ? 'Export erforderlich, um Ihre Arbeit zu sichern.' : 'Lokal gespeichert.'}</p>
      {allComplete && reviewComplete ? <main className="evaluation-complete"><section className="completion-content"><h1>Prüfung abgeschlossen</h1><ul className="completion-checks"><li><Check size={22} />{completeCount} / {bundle.packets.length} Prüfentscheidungen gespeichert</li></ul><div className="completion-actions"><button className="submit-button" onClick={exportProgress}><Download size={18} />Geprüftes Paket exportieren</button><button className="icon-button" onClick={() => setReviewComplete(false)}><RotateCcw size={18} />Prüfentscheidungen ansehen</button></div><p>Freigaben sind lokal gespeichert. Es wurde kein Feedback an Studierende versendet.</p></section></main> : packet && draft ? <div className="rating-layout">
        <PacketNavigator review label="Feedbackprüfung" states={states} activeIndex={packetIndex} onNavigate={index => { setPacketIndex(index); setError(''); setPreviewId(null) }}><p className="review-packet-state">{states[packetIndex] === 'submitted' ? 'Freigegeben' : states[packetIndex] === 'changed' ? 'Änderungen noch nicht freigegeben' : 'Noch nicht freigegeben'}</p></PacketNavigator>
        <main className="rating-main review-main">
          <ComparisonWorkspace reflection={<ReflectionViewer segments={packet.reflection.segments} activeId={previewId} activeIds={shownIds} scrollRef={scrollRef} evidenceSelection={activeFeedbackItem ? { ids: activeFeedbackItem.evidence_segment_ids, onToggle: toggleEvidence, label: activeLabel } : undefined} />}>
            <section className="source-panel review-feedback" aria-label="Feedbackentwurf"><div className="panel-title"><h2>Feedbackentwurf</h2></div><div className="source-scroll">
              <details className="original-feedback"><summary>Ursprüngliches generiertes Feedback</summary>{REVIEW_COMPONENTS.map(component => <section key={component}><FeedbackHeading component={component} />{packet.generated_feedback[component].map(item => <article className={selectedOriginal === item.item_id ? 'selected-feedback' : ''} key={item.item_id}><p>{item.text}</p><EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => showEvidence(item.evidence_segment_ids, null, item.item_id)} onActivate={id => { showEvidence(item.evidence_segment_ids, null, item.item_id); highlightEvidence(id) }} /></article>)}</section>)}</details>
              {REVIEW_COMPONENTS.map(component => <section className="feedback-editor-section" key={component}><FeedbackHeading component={component} />{draft.feedback[component].map((item, index) => <article key={item.item_id} className={activeItem?.id === item.item_id ? 'editing-item' : ''}>
                <label className="review-field">{componentLabels[component]} {index + 1}<textarea rows={3} value={item.text} onFocus={() => { setActiveItem({ component, id: item.item_id }); setShownIds([]); setSelectedOriginal(null) }} onChange={event => editFeedback({ ...draft.feedback, [component]: draft.feedback[component].map(value => value.item_id === item.item_id ? { ...value, text: event.target.value } : value) })} /></label>
                <EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => showEvidence(item.evidence_segment_ids, { component, id: item.item_id })} onActivate={id => { showEvidence(item.evidence_segment_ids, { component, id: item.item_id }); highlightEvidence(id) }} />
                <div className="review-item-actions"><button className="icon-button" aria-pressed={activeItem?.id === item.item_id} onClick={() => showEvidence(item.evidence_segment_ids, { component, id: item.item_id })}><Link size={16} />Belege bearbeiten</button><button className="icon-button danger" aria-label={`${componentLabels[component]} ${index + 1} entfernen`} title="Feedbackeintrag entfernen" onClick={() => { editFeedback({ ...draft.feedback, [component]: draft.feedback[component].filter(value => value.item_id !== item.item_id) }); if (activeItem?.id === item.item_id) setActiveItem(null) }}><Trash2 size={16} /></button></div>
              </article>)}<button className="icon-button" onClick={() => { const item = { item_id: crypto.randomUUID(), text: '', evidence_segment_ids: [] }; editFeedback({ ...draft.feedback, [component]: [...draft.feedback[component], item] }); setActiveItem({ component, id: item.item_id }) }}><Plus size={16} />Eintrag hinzufügen</button></section>)}
            </div></section>
          <section className="review-task-panel" aria-label="Prüfentscheidung">
            {error && <p className="rating-error" role="alert">{error}</p>}
            {approval && <p className={states[packetIndex] === 'changed' ? 'submission-note pending' : 'submission-note'}>{states[packetIndex] === 'changed' ? 'Änderungen noch nicht freigegeben' : `Freigegeben: ${decisionLabels[approval.decision]}`}</p>}
            <fieldset className="review-decisions"><legend>Prüfentscheidung</legend>{(Object.keys(decisionLabels) as ReviewDecision[]).map(decision => <label key={decision}><input type="radio" name="review-decision" value={decision} checked={draft.decision === decision} onChange={() => updateDraft({ ...draft, decision, updated_at: new Date().toISOString() })} />{decisionLabels[decision]}</label>)}</fieldset>
            <details className="review-timing"><summary>Technische Details</summary><dl><dt>Paket-ID</dt><dd>{packet.review_packet_id}</dd><dt>Erste Feedbackänderung</dt><dd>{draft.first_edited_at ?? 'Noch nicht bearbeitet'}</dd><dt>Letzte Freigabe</dt><dd>{approval?.approved_at ?? 'Noch nicht freigegeben'}</dd><dt>Zeit von der ersten Änderung bis zur Freigabe</dt><dd>{approval?.editing_to_approval_ms == null ? 'Nicht verfügbar' : `${(approval.editing_to_approval_ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Sekunden (einschließlich Pausen)`}</dd></dl></details>
            <div className="review-approve-actions"><button className="icon-button" onClick={() => { if (window.confirm('Generiertes Feedback wiederherstellen? Der Zeitpunkt der ersten Änderung bleibt erhalten.')) { const next = editReviewDraft(draft, structuredClone(packet.generated_feedback), new Date().toISOString()); updateDraft({ ...next, decision: 'use_as_generated' }); setActiveItem(null); setShownIds([]) } }}><RotateCcw size={18} />Generiertes Feedback wiederherstellen</button><button className="submit-button" onClick={approve}><Check size={18} />Speichern &amp; weiter</button>{allComplete && <button className="icon-button" onClick={() => setReviewComplete(true)}>Abschlussübersicht anzeigen</button>}</div>
          </section>
          </ComparisonWorkspace>
        </main>
      </div> : null}
    </>}
  </AppShell>
}