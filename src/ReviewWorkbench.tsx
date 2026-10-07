import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Check, Download, FileJson, Link, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { AppShell } from './AppShell'
import PacketNavigator from './PacketNavigator'
import { EvidenceReferences, ReflectionViewer } from './SourceComparison'
import { componentLabels } from './ratingTypes'
import { approveReview, editReviewDraft, initialReviewDraft, parseReviewBundle, REVIEW_COMPONENTS, REVIEW_SCHEMA, reviewIsCurrent, sameReviewValue, type ReviewBundle, type ReviewComponent, type ReviewDecision, type ReviewDraft, type ReviewFeedback, type ReviewProgress } from './reviewContract'
import './RatingWorkbench.css'
import './ReviewWorkbench.css'

const STORAGE_KEY = 'prebi-lecturer-review-v1'
const REVIEWER_KEY = 'prebi-lecturer-reviewer-v1'
const decisionLabels: Record<ReviewDecision, string> = { use_as_generated: 'Use as generated', use_with_edits: 'Use with edits', do_not_use: 'Do not use' }

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
      setStorageError('Browser storage is unavailable or full. Export progress before leaving this page.')
    }
  }

  function changeReviewer(value: string) {
    setReviewer(value)
    try { localStorage.setItem(REVIEWER_KEY, value) }
    catch { setStorageError('Reviewer code could not be stored locally.') }
  }

  function openBundle(value: unknown) {
    let loaded = parseReviewBundle(value)
    const code = loaded.progress?.reviewer_id.trim() || reviewer.trim()
    if (!code) throw new Error('Enter a reviewer code before opening a review bundle.')
    if (loaded.progress && reviewer.trim() && reviewer.trim() !== code) throw new Error('This progress file belongs to a different reviewer. Close the bundle and enter its reviewer code.')
    const localValue = storedBundles()[`${code}::${loaded.bundle_id}`]
    let local: ReviewBundle | null = null
    if (localValue) local = parseReviewBundle(localValue)
    if (local && !sameReviewValue(local.packets, loaded.packets)) throw new Error('This bundle ID already has different source material. Use a new bundle ID.')
    if (local && loaded.progress && !sameReviewValue(local.progress, loaded.progress)) {
      if (!window.confirm('Replace locally stored review progress with this uploaded progress file? Export local progress first if you need to keep both versions.')) return
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
    setStatus('Review bundle opened. Original feedback preserved.')
    persist(loaded)
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try { openBundle(JSON.parse(await file.text())) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open review bundle.') }
  }

  async function openSynthetic() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`)
      if (!response.ok) throw new Error('Could not load the synthetic example.')
      openBundle(await response.json())
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open synthetic example.') }
  }

  function updateDraft(nextDraft: ReviewDraft) {
    if (!bundle || !packet || !progress) return
    persist({ ...bundle, progress: { ...progress, drafts: { ...progress.drafts, [packet.review_packet_id]: nextDraft } } })
    setError('')
    setStatus('Draft updated.')
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
    const container = scrollRef.current
    const element = container && Array.from(container.children).find(child => child.getAttribute('data-segment-id') === id)
    if (container && element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - 24
  }

  function approve() {
    if (!packet || !bundle || !progress || !draft) return
    try {
      const nextApproval = approveReview(packet, draft, new Date().toISOString())
      const nextProgress = { ...progress, drafts: { ...progress.drafts, [packet.review_packet_id]: draft }, approvals: { ...progress.approvals, [packet.review_packet_id]: nextApproval } }
      persist({ ...bundle, progress: nextProgress })
      setError('')
      setStatus('Review decision recorded locally. No feedback has been sent.')
      let nextIndex = -1
      for (let offset = 1; offset < bundle.packets.length; offset++) {
        const index = (packetIndex + offset) % bundle.packets.length
        const item = bundle.packets[index]
        if (!reviewIsCurrent(nextProgress.drafts[item.review_packet_id], nextProgress.approvals[item.review_packet_id])) { nextIndex = index; break }
      }
      if (nextIndex === -1) setReviewComplete(true)
      else setPacketIndex(nextIndex)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not approve review.') }
  }

  function exportProgress() {
    if (bundle) downloadReview('prebi-review-progress.json', bundle)
  }

  function exportStored() {
    if (!reviewer.trim()) { setError('Enter a reviewer code.'); return }
    try {
      const entries = Object.values(storedBundles()).filter(value => value.progress?.reviewer_id === reviewer.trim())
      if (!entries.length) { setError('No stored review bundles for this reviewer.'); return }
      for (const value of entries) downloadReview('prebi-review-progress.json', parseReviewBundle(value))
    } catch { setError('Stored review progress could not be read.') }
  }

  const evidence = { selectedId: previewId, onPreview: setPreviewId, onActivate: highlightEvidence }

  return <AppShell workflow="Lecturer review" context={bundle ? <><span>{completeCount} / {bundle.packets.length} current approvals</span><span>Reviewer: {reviewer}</span></> : undefined}>
    <input ref={fileRef} type="file" className="packet-file-input" accept="application/json,.json" aria-label="Review bundle file" onChange={importFile} />
    {storageError && <p className="rating-error" role="alert">{storageError}</p>}
    {!bundle ? <main className="evaluation-start"><section className="start-content">
      <h1>Lecturer review</h1>
      <label className="annotator-field start-annotator">Reviewer code<input value={reviewer} onChange={event => changeReviewer(event.target.value)} autoComplete="off" /></label>
      {error && <p className="rating-error" role="alert">{error}</p>}
      <div className="review-start-actions"><button className="submit-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Open review bundle</button><button className="icon-button" onClick={openSynthetic}><FileJson size={18} />Open synthetic example</button></div>
      <p className="local-storage-note">Review drafts and approvals are stored locally in this browser.</p>
      <details className="start-storage-actions"><summary>Review files</summary><div className="review-start-actions"><button className="icon-button" onClick={exportStored}><Download size={18} />Export stored progress</button><button className="icon-button" onClick={() => downloadReview('prebi-review-bundle.schema.json', REVIEW_SCHEMA)}><Download size={18} />Download review schema</button><a href={`${import.meta.env.BASE_URL}examples/synthetic-review-bundle.json`} download>Download synthetic bundle</a></div></details>
    </section></main> : <>
      <div className="rating-toolbar"><span>Lecturer feedback review</span><div className="rating-actions"><button className="icon-button" onClick={exportProgress}><Download size={18} />Export progress</button><button className="icon-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Open review bundle</button><button className="icon-button" onClick={() => { setBundle(null); setError(''); setActiveItem(null) }}><X size={18} />Close bundle</button></div></div>
      <p className="review-status" role="status">{status} {storageError ? 'Export required to preserve work.' : 'Saved locally.'}</p>
      {allComplete && reviewComplete ? <main className="evaluation-complete"><section className="completion-content"><h1>Review complete</h1><ul className="completion-checks"><li><Check size={22} />{completeCount} / {bundle.packets.length} review decisions recorded</li></ul><div className="completion-actions"><button className="submit-button" onClick={exportProgress}><Download size={18} />Export reviewed bundle</button><button className="icon-button" onClick={() => setReviewComplete(false)}><RotateCcw size={18} />Review decisions</button></div><p>Approvals are stored locally. No feedback has been delivered to students.</p></section></main> : packet && draft ? <div className="rating-layout">
        <PacketNavigator review label="Lecturer review" states={states} activeIndex={packetIndex} onNavigate={index => { setPacketIndex(index); setError(''); setPreviewId(null) }}><p className="review-packet-state">{states[packetIndex] === 'submitted' ? 'Approved' : states[packetIndex] === 'changed' ? 'Approval has pending changes' : 'Not approved'}</p></PacketNavigator>
        <main className="rating-main review-main">
          <div className="comparison-area review-comparison">
            <ReflectionViewer segments={packet.reflection.segments} activeId={previewId} scrollRef={scrollRef} evidenceSelection={activeFeedbackItem ? { ids: activeFeedbackItem.evidence_segment_ids, onToggle: toggleEvidence, label: activeLabel } : undefined} />
            <section className="source-panel review-feedback" aria-label="Draft feedback"><div className="panel-title"><h2>Draft feedback</h2></div><div className="source-scroll">
              <details className="original-feedback"><summary>Original generated feedback</summary>{REVIEW_COMPONENTS.map(component => <section key={component}><h3>{componentLabels[component]}</h3>{packet.generated_feedback[component].map(item => <article key={item.item_id}><p>{item.text}</p><EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} /></article>)}</section>)}</details>
              {REVIEW_COMPONENTS.map(component => <section className="feedback-editor-section" key={component}><h3>{componentLabels[component]}</h3>{draft.feedback[component].map((item, index) => <article key={item.item_id} className={activeItem?.id === item.item_id ? 'editing-item' : ''}>
                <label className="review-field">{componentLabels[component]} {index + 1}<textarea rows={4} value={item.text} onChange={event => editFeedback({ ...draft.feedback, [component]: draft.feedback[component].map(value => value.item_id === item.item_id ? { ...value, text: event.target.value } : value) })} /></label>
                <EvidenceReferences ids={item.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} />
                <div className="review-item-actions"><button className="icon-button" aria-pressed={activeItem?.id === item.item_id} onClick={() => { setActiveItem({ component, id: item.item_id }); setPreviewId(null) }}><Link size={16} />Mark evidence for {componentLabels[component]} {index + 1}</button><button className="icon-button danger" aria-label={`Remove ${componentLabels[component]} ${index + 1}`} title="Remove feedback item" onClick={() => { editFeedback({ ...draft.feedback, [component]: draft.feedback[component].filter(value => value.item_id !== item.item_id) }); if (activeItem?.id === item.item_id) setActiveItem(null) }}><Trash2 size={16} /></button></div>
              </article>)}<button className="icon-button" onClick={() => { const item = { item_id: crypto.randomUUID(), text: '', evidence_segment_ids: [] }; editFeedback({ ...draft.feedback, [component]: [...draft.feedback[component], item] }); setActiveItem({ component, id: item.item_id }) }}><Plus size={16} />Add {componentLabels[component].toLowerCase()}</button></section>)}
            </div></section>
          </div>
          <section className="review-task-panel" aria-label="Review decision">
            {error && <p className="rating-error" role="alert">{error}</p>}
            {approval && <p className={states[packetIndex] === 'changed' ? 'submission-note pending' : 'submission-note'}>{states[packetIndex] === 'changed' ? 'Changes pending approval' : `Approved: ${decisionLabels[approval.decision]}`}</p>}
            <fieldset className="review-decisions"><legend>Review decision</legend>{(Object.keys(decisionLabels) as ReviewDecision[]).map(decision => <label key={decision}><input type="radio" name="review-decision" value={decision} checked={draft.decision === decision} onChange={() => updateDraft({ ...draft, decision, updated_at: new Date().toISOString() })} />{decisionLabels[decision]}</label>)}</fieldset>
            <details className="review-timing"><summary>Review timestamps</summary><dl><dt>First feedback edit</dt><dd>{draft.first_edited_at ?? 'Not edited'}</dd><dt>Last approval</dt><dd>{approval?.approved_at ?? 'Not approved'}</dd><dt>Elapsed edit-to-approval time</dt><dd>{approval?.editing_to_approval_ms == null ? 'Not available' : `${(approval.editing_to_approval_ms / 1000).toFixed(1)} seconds (including pauses)`}</dd></dl></details>
            <div className="review-approve-actions"><button className="icon-button" onClick={() => { if (window.confirm('Restore generated feedback? The first-edit timestamp will be retained.')) { const next = editReviewDraft(draft, structuredClone(packet.generated_feedback), new Date().toISOString()); updateDraft({ ...next, decision: 'use_as_generated' }); setActiveItem(null) } }}><RotateCcw size={18} />Restore generated feedback</button><button className="submit-button" onClick={approve}><Check size={18} />{approval ? 'Update approval & next' : 'Approve & next'}</button>{allComplete && <button className="icon-button" onClick={() => setReviewComplete(true)}>Show completion</button>}</div>
          </section>
        </main>
      </div> : null}
    </>}
  </AppShell>
}