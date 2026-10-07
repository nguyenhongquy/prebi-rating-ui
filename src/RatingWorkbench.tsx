import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { AppShell, EvaluationStart, PacketFileButton } from './AppShell'
import './RatingWorkbench.css'
import SourceComparison from './SourceComparison'
import { type Draft, type Packet, type RatingTask, type ScoreAnswer, type SpanComment } from './ratingTypes'
import { answerError, canonicalJson, evaluationSteps, responseForDraft, submissionState } from './ratingValidation'
import RatingProgress from './RatingProgress'
import PacketNavigator from './PacketNavigator'
import EvaluationComplete from './EvaluationComplete'
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
  feedback_implied_score: 'Feedback-implied score',
  assessment_quality: 'Assessment quality',
  feedback_quality: 'Feedback quality',
}
const STORAGE_KEY = 'prebi-rating-workbench-v1'
const TAGS = ['unsupported', 'inaccurate', 'vague', 'actionable', 'strength', 'concern', 'other']

function emptyDraft(packet: Packet): Draft {
  return {
    criterionRatings: Object.fromEntries((packet.criteria ?? []).map((item) => [item.criterion_id, { score: null, unable_to_judge: false, comment: '' }])),
    scoreAnswers: Object.fromEntries((packet.score_dimensions ?? []).map((item) => [item.dimension_id, { status: 'not_inferable', score: null, confidence: 'not_inferable', rationale: '', feedback_evidence: [] }])),
    overallComment: '',
    spanComments: [],
  }
}

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

function isPacket(value: unknown): value is Packet {
  if (!value || typeof value !== 'object') return false
  const packet = value as Partial<Packet>
  const commonFields = typeof packet.packet_id === 'string'
    && ['assessment_quality', 'feedback_quality', 'feedback_implied_score'].includes(String(packet.task))
    && packet.condition_blinded === true
    && typeof packet.human_protocol === 'string'
    && Array.isArray(packet.reflection?.segments)
    && Array.isArray(packet.rubric?.dimensions)
    && typeof packet.rubric.version === 'string'
    && typeof packet.protocol_id === 'string'
    && typeof packet.protocol_version === 'string'
  if (!commonFields) return false
  if (packet.task === 'assessment_quality') return Array.isArray(packet.criteria) && Array.isArray(packet.output?.dimensions)
  if (packet.task === 'feedback_quality') return Array.isArray(packet.criteria) && ['strengths', 'weaknesses', 'suggestions'].every((key) => Array.isArray(packet.output?.[key as keyof NonNullable<Packet['output']>]))
  return typeof packet.human_feedback === 'string' && Array.isArray(packet.score_dimensions)
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function RatingWorkbench() {
  const [packets, setPackets] = useState<Packet[]>([])
  const [packetIndex, setPacketIndex] = useState(0)
  const [taskFilter, setTaskFilter] = useState<RatingTask>('feedback_implied_score')
  const [evaluatorId, setEvaluatorId] = useState(() => localStorage.getItem('prebi-rating-evaluator') ?? '')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Draft> }
    catch { return {} }
  })
  const [submitted, setSubmitted] = useState<Record<string, SavedRating>>(() => {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}-submitted`) ?? '{}') as Record<string, SavedRating> }
    catch { return {} }
  })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Upload the protected packet bundle to begin.')
  const [selectedSpan, setSelectedSpan] = useState<{ component: string; index: number; start: number; end: number; quote: string } | null>(null)
  const [spanComment, setSpanComment] = useState('')
  const [spanTags, setSpanTags] = useState<string[]>([])
  const [criterionIndex, setCriterionIndex] = useState(0)
  const [reviewingComplete, setReviewingComplete] = useState(false)

  const taskPackets = useMemo(() => packets.filter((packet) => packet.task === taskFilter), [packets, taskFilter])
  const packet = taskPackets[packetIndex] ?? null
  const currentKey = packet && evaluatorId.trim() ? queueKey(packet, evaluatorId) : ''
  const draft = packet ? (drafts[currentKey] ?? emptyDraft(packet)) : null
  function packetState(item: Packet) {
    const key = queueKey(item, evaluatorId)
    return submissionState(item, drafts[key], submitted[key]?.response)
  }
  const packetStates = taskPackets.map(packetState)
  const doneCount = packetStates.filter(state => state === 'submitted').length
  const steps = packet ? evaluationSteps(packet) : []
  const bundleDoneCount = packets.filter(item => packetState(item) === 'submitted').length
  const bundleComplete = packets.length > 0 && bundleDoneCount === packets.length
  const taskComplete = taskPackets.length > 0 && doneCount === taskPackets.length
  const completionReady = taskComplete || bundleComplete
  const showCompletion = completionReady && !reviewingComplete
  const summaries = (Object.keys(TASK_LABELS) as RatingTask[]).map(task => {
    const items = packets.filter(item => item.task === task)
    return { task, label: TASK_LABELS[task], total: items.length, complete: items.filter(item => packetState(item) === 'submitted').length }
  }).filter(summary => summary.total > 0)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
  }, [drafts])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}-submitted`, JSON.stringify(submitted))
  }, [submitted])

  useEffect(() => {
    localStorage.setItem('prebi-rating-evaluator', evaluatorId)
  }, [evaluatorId])

  useEffect(() => {
    setPacketIndex(0)
    setSelectedSpan(null)
    setReviewingComplete(false)
  }, [taskFilter, evaluatorId])

  useEffect(() => {
    setSelectedSpan(null)
    setSpanComment('')
    setSpanTags([])
    setCriterionIndex(0)
    setError('')
  }, [packet?.packet_id, evaluatorId])

  function navigateCriterion(index: number) {
    setCriterionIndex(index)
    setError('')
  }

  function nextCriterion() {
    if (!packet || !draft) return
    if (!evaluatorId.trim()) {
      setError('Enter your annotator code before rating.')
      return
    }
    const message = answerError(packet, draft, criterionIndex)
    if (message) {
      setError(message)
      return
    }
    navigateCriterion(Math.min(steps.length - 1, criterionIndex + 1))
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!packet || !currentKey || !draft) return
    setDrafts((current) => ({ ...current, [currentKey]: { ...draft, ...patch } }))
  }

  async function importPacketFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const loaded = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { packets?: unknown }).packets)
          ? (parsed as { packets: unknown[] }).packets
          : [parsed]
      if (!loaded.every(isPacket)) throw new Error('Die Datei muss verblindete Bewertungspakete enthalten.')
      const seen = new Set<string>()
      for (const item of loaded as Packet[]) {
        if (seen.has(item.packet_id)) throw new Error('Die Paket-IDs in der hochgeladenen Datei müssen eindeutig sein.')
        seen.add(item.packet_id)
        if (item.displayed_reflection_sha256 && await sha256(item.reflection) !== item.displayed_reflection_sha256) {
          throw new Error('Die Prüfsumme einer Reflexion stimmt nicht mit dem angezeigten Inhalt überein.')
        }
        if (item.display_output_sha256 && await sha256(item.output ?? item.human_feedback) !== item.display_output_sha256) {
          throw new Error('Die Prüfsumme einer Ausgabe stimmt nicht mit dem angezeigten Inhalt überein.')
        }
      }
      const shuffled = [...loaded as Packet[]].sort(() => Math.random() - 0.5)
      setPackets(shuffled)
      setPacketIndex(0)
      setCriterionIndex(0)
      setReviewingComplete(false)
      const firstTask = (shuffled[0]?.task ?? 'feedback_implied_score') as RatingTask
      setTaskFilter(firstTask)
      setStatus(`Loaded ${shuffled.length} blinded packets. Order randomized for this session.`)
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'Die Datei enthält kein gültiges JSON.' : caught instanceof Error ? caught.message : 'Die Paketdatei konnte nicht gelesen werden.')
    }
  }

  function submitRating() {
    if (!packet || !draft || !evaluatorId.trim()) {
      setError('Enter your annotator code before submitting.')
      return
    }
    for (let index = 0; index < steps.length; index++) {
      const message = answerError(packet, draft, index)
      if (message) {
        setCriterionIndex(index)
        setError(message)
        return
      }
    }
    const record: SavedRating = {
      schema_version: '1.0.0',
      rating_id: crypto.randomUUID(),
      packet_id: packet.packet_id,
      task: packet.task,
      evaluator_type: 'human',
      evaluator_id: evaluatorId.trim(),
      protocol_id: packet.protocol_id,
      protocol_version: packet.protocol_version,
      packet_version: packet.packet_version,
      display_output_sha256: packet.display_output_sha256,
      displayed_reflection_sha256: packet.displayed_reflection_sha256,
      submitted_at: new Date().toISOString(),
      response: responseForDraft(packet, draft),
    }
    setSubmitted((current) => ({ ...current, [currentKey]: record }))
    setError('')
    setStatus('Rating submitted and saved in this browser. Download the result JSON for protected collection.')
    setReviewingComplete(false)
    for (let offset = 1; offset < taskPackets.length; offset++) {
      const nextIndex = (packetIndex + offset) % taskPackets.length
      if (packetStates[nextIndex] !== 'submitted') {
        setPacketIndex(nextIndex)
        break
      }
    }
  }

  function addSpanComment() {
    if (!selectedSpan || !spanComment.trim()) return
    const comment: SpanComment = {
      feedback_component: selectedSpan.component,
      feedback_item_index: selectedSpan.index,
      start_character: selectedSpan.start,
      end_character: selectedSpan.end,
      comment: spanComment.trim(),
      tags: spanTags,
      linked_reflection_segment_ids: [],
    }
    updateDraft({ spanComments: [...(draft?.spanComments ?? []), comment] })
    setSpanComment('')
    setSpanTags([])
    setSelectedSpan(null)
  }

  function handleFeedbackSelection(event: React.SyntheticEvent<HTMLTextAreaElement>, component: string, index: number) {
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    if (start < end) setSelectedSpan({ component, index, start, end, quote: target.value.slice(start, end) })
  }

  function downloadCurrent() {
    if (!packet || !currentKey) return
    const rating = submitted[currentKey]
    if (!rating) return
    downloadJson(`rating-${rating.rating_id}.json`, rating)
  }

  function downloadCompleted() {
    const records = taskPackets.map((item) => submitted[queueKey(item, evaluatorId)]).filter(Boolean)
    if (!records.length) return
    downloadJson(`ratings-${taskFilter}.json`, { schema_version: '1.0.0', ratings: records })
  }

  function downloadBundle() {
    const records = packets.map(item => submitted[queueKey(item, evaluatorId)]).filter(Boolean)
    if (records.length) downloadJson('ratings-evaluation.json', { schema_version: '1.0.0', ratings: records })
  }

  function continueNextTask() {
    const next = summaries.find(summary => summary.complete < summary.total)
    if (next) setTaskFilter(next.task)
  }

  function clearLocalData() {
    if (!window.confirm('Alle lokalen Entwürfe und abgeschlossenen Bewertungen aus diesem Browser löschen? Laden Sie abgeschlossene Bewertungen vorher herunter.')) return
    setDrafts({})
    setSubmitted({})
    setCriterionIndex(0)
    setReviewingComplete(false)
    setStatus('Local drafts and submissions cleared.')
  }

  const savedForEvaluator = Object.values(submitted).filter((rating) => rating.evaluator_id === evaluatorId.trim())

  return <AppShell workflow="Expert evaluation" context={packets.length > 0 ? <><span>{TASK_LABELS[taskFilter]} · {doneCount} / {taskPackets.length} current submissions</span><label className="annotator-field">Annotator code<input value={evaluatorId} onChange={(event) => setEvaluatorId(event.target.value)} placeholder="Your assigned code" autoComplete="off" /></label></> : undefined}>
    {(!packet || showCompletion) && error && <div className="rating-error" role="alert">{error}</div>}
    {!packets.length ? <EvaluationStart evaluatorId={evaluatorId} onEvaluatorChange={setEvaluatorId} onImport={importPacketFile} savedCount={savedForEvaluator.length} onExportSaved={() => downloadJson('ratings-stored.json', { schema_version: '1.0.0', ratings: savedForEvaluator })} onClear={clearLocalData} /> : <>
    <div className="rating-toolbar">
      <div className="task-tabs" role="tablist" aria-label="Rating task">
        {(Object.keys(TASK_LABELS) as RatingTask[]).map((task) => <button key={task} role="tab" aria-selected={taskFilter === task} className={taskFilter === task ? 'active' : ''} onClick={() => setTaskFilter(task)}>{TASK_LABELS[task]}</button>)}
      </div>
      <details className="file-management">
        <summary><FileJson size={18} />Files &amp; local data</summary>
        <div className="rating-actions">
        <PacketFileButton onImport={importPacketFile} />
        <button className="icon-button" onClick={downloadCompleted} disabled={!taskPackets.some(item => submitted[queueKey(item, evaluatorId)])} title="Download submitted ratings; pending draft edits are not included"><Download size={16} /><span>Export submitted ratings</span></button>
        <button className="icon-button danger" onClick={clearLocalData} title="Clear local drafts and submitted ratings"><Trash2 size={16} /><span>Clear local data</span></button>
        </div>
      </details>
    </div>
    <div className="rating-status"><ShieldCheck size={16} />{status} Drafts and submissions stay in this browser until downloaded.</div>
    {showCompletion ? <EvaluationComplete bundleComplete={bundleComplete} taskLabel={TASK_LABELS[taskFilter]} taskTotal={taskPackets.length} packetTotal={packets.length} summaries={summaries} onExport={bundleComplete ? downloadBundle : downloadCompleted} onReview={() => setReviewingComplete(true)} onContinue={continueNextTask} /> : !packet ? <div className="rating-empty"><FileJson size={34} /><strong>No packet for this task</strong><span>Upload the protected packet bundle to start annotating.</span></div> : <div className="rating-layout">
      <PacketNavigator label={TASK_LABELS[taskFilter]} states={packetStates} activeIndex={packetIndex} onNavigate={setPacketIndex}>
        <details className="protocol-details"><summary>Rating guide · {packet.protocol_version}</summary><pre>{packet.human_protocol}</pre></details>
        <details className="rubric-details"><summary>Rubric · {packet.rubric.version}</summary>{packet.rubric.dimensions.map((dimension) => <div className="rubric-dimension" key={dimension.dimension_id}><strong>{dimension.dimension_id} · {dimension.name}</strong><p>{dimension.description}</p><dl>{Object.entries(dimension.bands).map(([band, description]) => <div key={band}><dt>{band}</dt><dd>{description}</dd></div>)}</dl></div>)}</details>
      </PacketNavigator>
      <main className="rating-main">
        <SourceComparison key={packet.packet_id} packet={packet} onSelection={handleFeedbackSelection} />
        <section className="task-panel" aria-label="Your evaluation">
          <div className="panel-title"><span>Your evaluation</span></div>
          <RatingProgress packet={packet} draft={draft!} activeIndex={criterionIndex} onNavigate={navigateCriterion} />
          {submitted[currentKey] && <p className={`submission-note${packetStates[packetIndex] === 'changed' ? ' pending' : ''}`} role="status">{packetStates[packetIndex] === 'changed' ? <Pencil size={18} /> : <Check size={18} />}{packetStates[packetIndex] === 'changed' ? 'Draft changes are not submitted. Update the rating to include them in exports.' : 'This rating is submitted.'}</p>}
          {error && <div className="rating-error" role="alert">{error}</div>}
          {!!steps.length && <p className="criterion-position">{packet.task === 'feedback_implied_score' ? 'Dimension' : 'Criterion'} {criterionIndex + 1} of {steps.length}</p>}
          {packet.task === 'feedback_implied_score' ? <ScoreCoding packet={packet} draft={draft!} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={setSpanComment} addSpanComment={addSpanComment} /> : <QualityRating packet={packet} draft={draft!} activeIndex={criterionIndex} updateDraft={updateDraft} selectedSpan={selectedSpan} spanComment={spanComment} setSpanComment={setSpanComment} spanTags={spanTags} setSpanTags={setSpanTags} addSpanComment={addSpanComment} />}
        </section>
        <footer className="rating-footer">
          <span><Save size={15} />{currentKey ? 'Autosaved locally' : 'Enter annotator code to save drafts'}</span>
          <div>{submitted[currentKey] && <button className="icon-button" onClick={downloadCurrent}><Download size={16} />Download this rating</button>}<button className="icon-button" disabled={criterionIndex === 0} onClick={() => navigateCriterion(criterionIndex - 1)}><ChevronLeft size={16} />Previous {packet.task === 'feedback_implied_score' ? 'dimension' : 'criterion'}</button>{criterionIndex < steps.length - 1 ? <button className="submit-button" onClick={nextCriterion}><Save size={16} />Save &amp; next<ChevronRight size={16} /></button> : <button className="submit-button" onClick={submitRating}><Check size={16} />{submitted[currentKey] ? 'Update rating' : 'Submit rating'}</button>}</div>
          {completionReady && <button className="icon-button" onClick={() => setReviewingComplete(false)}><Check size={16} />Show completion</button>}
        </footer>
      </main>
    </div>}
    </>}
  </AppShell>
}

function ScoreCoding({ packet, draft, activeIndex, updateDraft, selectedSpan, spanComment, setSpanComment, addSpanComment }: {
  packet: Packet; draft: Draft; activeIndex: number; updateDraft: (patch: Partial<Draft>) => void
  selectedSpan: { component: string; index: number; start: number; end: number; quote: string } | null
  spanComment: string; setSpanComment: (value: string) => void; addSpanComment: () => void
}) {
  return <div>
    {selectedSpan?.component === 'human_feedback' && <div className="span-editor"><strong>Selected evidence: “{selectedSpan.quote}”</strong><textarea value={spanComment} onChange={(event) => setSpanComment(event.target.value)} placeholder="Evidence note for this excerpt" rows={2} /><button className="icon-button" onClick={addSpanComment}>Add evidence note</button></div>}
    <div className="score-grid">{(packet.score_dimensions ?? []).slice(activeIndex, activeIndex + 1).map((dimension) => {
      const answer = draft.scoreAnswers[dimension.dimension_id]
      return <article className="score-card" key={dimension.dimension_id}>
        <header><span>{dimension.dimension_id}</span><strong>{dimension.label}</strong></header>
        <label className="infer-toggle"><input type="checkbox" checked={answer.status === 'inferred_from_feedback'} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: event.target.checked ? { ...answer, status: 'inferred_from_feedback', confidence: 'medium' } : { status: 'not_inferable', score: null, confidence: 'not_inferable', rationale: answer.rationale, feedback_evidence: [] } } })} />Score inferable from feedback</label>
        {answer.status === 'inferred_from_feedback' && <div className="two-column"><label className="field"><span>Implied score <small>0.0–3.0 in tenths</small></span><input type="number" min="0" max="3" step="0.1" value={answer.score ?? ''} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, score: event.target.value === '' ? null : Number(event.target.value) } } })} /></label><label className="field"><span>Confidence</span><select value={answer.confidence} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, confidence: event.target.value as ScoreAnswer['confidence'] } } })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>}
        <label className="field"><span>Rationale</span><textarea rows={3} value={answer.rationale} onChange={(event) => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, rationale: event.target.value } } })} /></label>
        {selectedSpan?.component === 'human_feedback' && <button className="text-button use-evidence" onClick={() => { updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, feedback_evidence: [...answer.feedback_evidence, { start_character: selectedSpan.start, end_character: selectedSpan.end, quote: selectedSpan.quote }] } } }); }}>Use selected excerpt as evidence</button>}
        {answer.feedback_evidence.map((evidence, index) => <p className="evidence-chip" key={`${evidence.start_character}-${index}`}>“{evidence.quote}” <button className="text-button" onClick={() => updateDraft({ scoreAnswers: { ...draft.scoreAnswers, [dimension.dimension_id]: { ...answer, feedback_evidence: answer.feedback_evidence.filter((_, itemIndex) => itemIndex !== index) } } })}>Remove</button></p>)}
      </article>
    })}</div>
    <p className="annotation-note">Selecting text in the feedback marks an evidence span. If no defensible score is implied, leave the score as not inferable rather than assigning zero.</p>
  </div>
}

function QualityRating({ packet, draft, activeIndex, updateDraft, selectedSpan, spanComment, setSpanComment, spanTags, setSpanTags, addSpanComment }: {
  packet: Packet; draft: Draft; activeIndex: number; updateDraft: (patch: Partial<Draft>) => void
  selectedSpan: { component: string; index: number; start: number; end: number; quote: string } | null
  spanComment: string; setSpanComment: (value: string) => void; spanTags: string[]; setSpanTags: (value: string[]) => void; addSpanComment: () => void
}) {
  return <div>
    {packet.task === 'feedback_quality' && <>
      {selectedSpan && <div className="span-editor"><strong>Selected: “{selectedSpan.quote}”</strong><textarea value={spanComment} onChange={(event) => setSpanComment(event.target.value)} placeholder="Comment on this feedback span" rows={2} /><div className="tag-list">{TAGS.map((tag) => <label key={tag}><input type="checkbox" checked={spanTags.includes(tag)} onChange={(event) => setSpanTags(event.target.checked ? [...spanTags, tag] : spanTags.filter((value) => value !== tag))} />{tag}</label>)}</div><button className="icon-button" onClick={addSpanComment}>Add span comment</button></div>}
      {!!draft.spanComments.length && <div className="span-list"><h3>Span comments ({draft.spanComments.length})</h3>{draft.spanComments.map((comment, index) => <div key={`${comment.feedback_component}-${comment.feedback_item_index}-${comment.start_character}-${index}`}><span>{comment.feedback_component} · “{feedbackText(packet, comment.feedback_component, comment.feedback_item_index).slice(comment.start_character, comment.end_character)}”</span><p>{comment.comment}</p></div>)}</div>}
    </>}
    <div className="quality-criteria">{(packet.criteria ?? []).slice(activeIndex, activeIndex + 1).map((criterion) => {
      const answer = draft.criterionRatings[criterion.criterion_id]
      const scaleMin = packet.scale?.min ?? 1
      const scaleMax = packet.scale?.max ?? 5
      const scores = Array.from({ length: scaleMax - scaleMin + 1 }, (_, index) => scaleMin + index)
      const anchors = criterion.anchors ?? packet.scale?.anchors
      return <article className="criterion" key={criterion.criterion_id}>
        <div className="criterion-heading"><div><h3>{criterion.label}</h3><p>{criterion.description}</p></div><label className="unable"><input type="checkbox" checked={answer.unable_to_judge} onChange={(event) => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, score: event.target.checked ? null : answer.score, unable_to_judge: event.target.checked } } })} />Unable to judge</label></div>
        <div className="score-buttons" role="group" aria-label={`${criterion.label} score`}>{scores.map((score) => <button key={score} title={anchors?.[String(score)]} className={answer.score === score && !answer.unable_to_judge ? 'chosen' : ''} disabled={answer.unable_to_judge} aria-pressed={answer.score === score && !answer.unable_to_judge} onClick={() => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, score, unable_to_judge: false } } })}>{score}</button>)}</div>
        {anchors && <dl className="criterion-anchors">{scores.map((score) => <div key={score}><dt>{score}</dt><dd>{anchors[String(score)]}</dd></div>)}</dl>}
        <label className="field"><span>Rationale / comment <small>{answer.unable_to_judge ? 'Required' : 'Optional'}</small></span><textarea rows={2} value={answer.comment} onChange={(event) => updateDraft({ criterionRatings: { ...draft.criterionRatings, [criterion.criterion_id]: { ...answer, comment: event.target.value } } })} /></label>
      </article>
    })}</div>
    <label className="field overall-comment"><span>Overall comment <small>Optional</small></span><textarea rows={3} value={draft.overallComment} onChange={(event) => updateDraft({ overallComment: event.target.value })} /></label>
  </div>
}

function feedbackText(packet: Packet, component: string, index: number) {
  if (component !== 'strengths' && component !== 'weaknesses' && component !== 'suggestions') return ''
  return packet.output?.[component]?.[index]?.text ?? ''
}
