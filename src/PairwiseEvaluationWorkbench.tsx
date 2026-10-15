import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react'
import { AppShell } from './AppShell'
import { readSession, writeSession } from './localSessions'
import PairwiseReferenceScoring from './PairwiseReferenceScoring'
import SegmentSummaryPanel from './SegmentSummaryPanel'
import { EvidenceReferences, FeedbackHeading, ReflectionViewer, scrollToEvidence } from './SourceComparison'
import type { CandidateLabel, FeedbackCandidate, FeedbackEvaluationCase, PairKey, PairPreference, PairwiseEvaluationSession, PairwiseInputBundle, ReleaseChoice } from './pairwiseEvaluationTypes'
import { confirmReferenceScores, createEvaluationSession, researchExport, setExplanation, setPairPreference, setReferenceComment, setReferenceScore, setReleaseDecision, validateEvaluationSession } from './pairwiseEvaluationSession'
import { canonicalEvaluationJson, caseCompletion, pairCandidates, validateEvaluationBundle } from './pairwiseEvaluationValidation'
import './PairwiseEvaluationWorkbench.css'

const labels: CandidateLabel[] = ['A', 'B', 'C']
const pairKeys: PairKey[] = ['A-B', 'A-C', 'B-C']
const candidateLabels: Record<CandidateLabel, string> = { A: 'Feedback A', B: 'Feedback B', C: 'Feedback C' }
type PendingSession = { incoming: PairwiseEvaluationSession; saved: PairwiseEvaluationSession; incomingIsBackup: boolean }
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type Task = 'reference' | 'release' | 'preference'

function initialTask(session: PairwiseEvaluationSession, index: number): Task {
  const evaluationCase = session.input_bundle.cases[index]
  return evaluationCase && session.responses[evaluationCase.case_id]?.reference_confirmed_at ? 'release' : 'reference'
}

function sessionKey(session: Pick<PairwiseEvaluationSession, 'evaluator_id' | 'input_bundle_sha256'>) {
  return `pairwise::${encodeURIComponent(session.evaluator_id)}::${session.input_bundle_sha256}`
}

async function bundleHash(bundle: PairwiseInputBundle) {
  if (!globalThis.crypto?.subtle) throw new Error('Die Integritätsprüfung ist nicht verfügbar. Öffnen Sie die App über HTTPS oder localhost.')
  const bytes = new TextEncoder().encode(canonicalEvaluationJson(bundle))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function readJsonFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error('Die ausgewählte Datei enthält kein gültiges JSON.')
  }
}

function candidateFor(evaluationCase: FeedbackEvaluationCase, candidateId: string): FeedbackCandidate {
  const candidate = evaluationCase.candidates.find(item => item.candidate_id === candidateId)
  if (!candidate) throw new Error('Der Kandidat für die feste A/B/C-Anzeigereihenfolge fehlt.')
  return candidate
}

function FeedbackText({ candidate, label, segments, activeEvidence, onPreviewEvidence, onActivateEvidence }: {
  candidate: FeedbackCandidate
  label: string
  segments: FeedbackEvaluationCase['reflection']['segments']
  activeEvidence: string | null
  onPreviewEvidence: (id: string | null) => void
  onActivateEvidence: (id: string) => void
}) {
  return <section className="pairwise-feedback-card" aria-label={`Vollständiges Feedback ${label}`}>
    <h3>{label}</h3>
    {(['strengths', 'weaknesses', 'suggestions'] as const).map(component => {
      const texts = candidate.feedback[component]
      if (!texts?.length) return null
      return <section className="pairwise-feedback-component" key={component}>
        <FeedbackHeading component={component} />
        <ul>{texts.map((entry, index) => <li key={index}>
          <p>{entry.text}</p>
          <EvidenceReferences ids={entry.evidence_segment_ids} segments={segments} selectedId={activeEvidence} onPreview={onPreviewEvidence} onActivate={onActivateEvidence} />
        </li>)}</ul>
      </section>
    })}
  </section>
}

function FilePicker({ label, accept, onChange, icon, primary = false }: {
  label: string
  accept: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  icon: ReactNode
  primary?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <input ref={input} className="pairwise-file-input" type="file" accept={accept} onChange={onChange} tabIndex={-1} aria-hidden="true" />
    <button className={primary ? 'submit-button open-packet-button' : 'icon-button'} onClick={() => input.current?.click()}>{icon}{label}</button>
  </>
}

export default function PairwiseEvaluationWorkbench() {
  const [evaluatorId, setEvaluatorId] = useState('')
  const [session, setSession] = useState<PairwiseEvaluationSession | null>(null)
  const [pending, setPending] = useState<PendingSession | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [task, setTask] = useState<Task>('reference')
  const [candidateTab, setCandidateTab] = useState<CandidateLabel>('A')
  const [pairTab, setPairTab] = useState<PairKey>('A-B')
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const reflectionRef = useRef<HTMLDivElement>(null)

  const cases = session?.input_bundle.cases ?? []
  const activeIndex = session?.active_case_index ?? 0
  const activeCase = cases[activeIndex]
  const activeResponse = activeCase && session ? session.responses[activeCase.case_id] : undefined
  const candidateIds = activeCase?.candidates.map(candidate => candidate.candidate_id) ?? []
  const dimensionIds = session?.input_bundle.reference_scoring.dimensions.map(dimension => dimension.dimension_id) ?? []
  const completion = activeResponse ? caseCompletion(activeResponse, candidateIds, dimensionIds) : { complete: false, referenceConfirmed: false, decisions: 0, total: dimensionIds.length + 6 }
  const completedCases = session ? cases.filter(item => caseCompletion(session.responses[item.case_id], item.candidates.map(candidate => candidate.candidate_id), dimensionIds).complete).length : 0
  const referenceConfirmed = Boolean(activeResponse?.reference_confirmed_at)
  const releaseComplete = referenceConfirmed && candidateIds.length === 3 && candidateIds.every(id => !!activeResponse?.release_readiness[id])

  useEffect(() => {
    if (!session) return
    setSaveStatus('saving')
    setSaveError('')
    const key = sessionKey(session)
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => writeSession(key, session))
    void saveQueue.current.then(() => setSaveStatus('saved')).catch(() => {
      setSaveStatus('error')
      setSaveError('Der lokale Stand konnte nicht gespeichert werden. Exportieren Sie eine Sitzungssicherung, bevor Sie die Seite schließen.')
    })
  }, [session, saveAttempt])

  function begin(sessionToOpen: PairwiseEvaluationSession) {
    setSession(sessionToOpen)
    setTask(initialTask(sessionToOpen, sessionToOpen.active_case_index))
    setCandidateTab('A')
    setPairTab('A-B')
    setPending(null)
    setError('')
  }

  async function findExisting(incoming: PairwiseEvaluationSession, incomingIsBackup: boolean) {
    const savedValue = await readSession<unknown>(sessionKey(incoming))
    if (savedValue === undefined) {
      begin(incoming)
      return
    }
    const saved = validateEvaluationSession(savedValue)
    const incomingBundleHash = await bundleHash(incoming.input_bundle)
    if (saved.evaluator_id !== incoming.evaluator_id || saved.input_bundle_sha256 !== incomingBundleHash
      || canonicalEvaluationJson(saved.input_bundle) !== canonicalEvaluationJson(incoming.input_bundle)) {
      throw new Error('Die lokal gespeicherte Sitzung passt nicht zu dieser Bewertungs-ID und diesem Evaluationspaket.')
    }
    setPending({ incoming, saved, incomingIsBackup })
  }

  async function importBundle(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const id = evaluatorId.trim()
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Bitte geben Sie zuerst Ihre pseudonyme Bewertungs-ID ein (1–64 Zeichen, ohne Leerzeichen).')
      const bundle = validateEvaluationBundle(await readJsonFile(file))
      const hash = await bundleHash(bundle)
      await findExisting(createEvaluationSession(bundle, id, hash), false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Das Evaluationspaket konnte nicht geöffnet werden.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const incoming = validateEvaluationSession(await readJsonFile(file))
      if (evaluatorId.trim() !== incoming.evaluator_id) throw new Error('Die Sicherung gehört zu einer anderen Bewertungs-ID. Geben Sie die zugehörige ID ein.')
      if (await bundleHash(incoming.input_bundle) !== incoming.input_bundle_sha256) throw new Error('Die Sicherung enthält ein Evaluationspaket, dessen Prüfsumme nicht stimmt.')
      await findExisting(incoming, true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Sitzungssicherung konnte nicht geöffnet werden.')
    } finally {
      setBusy(false)
    }
  }

  function updateSession(update: (current: PairwiseEvaluationSession) => PairwiseEvaluationSession) {
    setSession(current => current ? update(current) : current)
  }

  function updateRelease(candidateId: string, choice: ReleaseChoice) {
    if (!session || !activeCase) return
    try { setSession(setReleaseDecision(session, activeCase.case_id, candidateId, choice)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Freigabeentscheidung konnte nicht gespeichert werden.') }
  }

  function updateReference(update: (current: PairwiseEvaluationSession, caseId: string) => PairwiseEvaluationSession, failure: string) {
    if (!session || !activeCase) return
    try { setSession(update(session, activeCase.case_id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : failure) }
  }

  function confirmReference() {
    if (!session || !activeCase) return
    try {
      setSession(confirmReferenceScores(session, activeCase.case_id))
      setCandidateTab('A')
      setTask('release')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Referenzbewertung konnte nicht abgeschlossen werden.') }
  }

  function updatePreference(pair: PairKey, preference: PairPreference) {
    if (!session || !activeCase) return
    try { setSession(setPairPreference(session, activeCase.case_id, pair, preference)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Präferenzentscheidung konnte nicht gespeichert werden.') }
  }

  function navigate(index: number) {
    if (!session || index < 0 || index >= cases.length) return
    updateSession(current => ({ ...current, active_case_index: index, updated_at: new Date().toISOString() }))
    setTask(initialTask(session, index))
    setActiveEvidence(null)
  }

  function activateEvidence(segmentId: string) {
    setActiveEvidence(segmentId)
    scrollToEvidence(reflectionRef.current, segmentId)
  }

  const caseName = activeCase ? `Reflexion ${activeIndex + 1} von ${cases.length}` : undefined

  return <AppShell workflow="Pairwise evaluation" context={session
    ? <><span>{session.evaluator_id} · {caseName} · {completedCases} von {cases.length} Reflexionen abgeschlossen</span><span className={`pairwise-save-indicator save-${saveStatus}`} role="status">{saveStatus === 'saving' ? 'Speichert …' : saveStatus === 'saved' ? 'Lokal gespeichert' : saveStatus === 'error' ? 'Speichern fehlgeschlagen' : 'Noch nicht gespeichert'}</span></>
    : undefined}>
    {error && <div className="rating-error" role="alert">{error}</div>}
    {pending ? <main className="evaluation-start">
      <section className="start-content pairwise-start-content">
        <h1>Gespeicherte Sitzung gefunden</h1>
        <p>Für diese Bewertungs-ID und dieses Paket gibt es bereits eine Sitzung. {pending.incomingIsBackup ? 'Sie können den lokal gespeicherten Stand fortsetzen oder den Stand aus der geöffneten Sicherung verwenden.' : 'Sie können den lokal gespeicherten Stand fortsetzen oder mit dem Paket neu beginnen. Ein Neustart ersetzt die bisher gespeicherten Antworten.'}</p>
        <div className="rating-actions">
          <button className="submit-button" onClick={() => begin(pending.saved)}>Lokal gespeicherten Stand fortsetzen</button>
          {pending.incomingIsBackup
            ? <button className="icon-button" onClick={() => begin(pending.incoming)}>Geöffnete Sitzungssicherung verwenden</button>
            : <button className="icon-button danger" onClick={() => {
              if (window.confirm('Möchten Sie wirklich mit einer leeren Sitzung neu beginnen und den lokal gespeicherten Stand ersetzen?')) begin(pending.incoming)
            }}>Neu beginnen und bisherigen Stand ersetzen</button>}
          <button className="icon-button" onClick={() => downloadJson('prebi-pairwise-session-backup.json', pending.saved)}><Download size={16} />Lokalen Stand sichern</button>
          <button className="icon-button" onClick={() => setPending(null)}>Abbrechen</button>
        </div>
      </section>
    </main> : !session ? <main className="evaluation-start">
      <section className="start-content pairwise-start-content">
        <h1>PReBi-Expertenevaluation</h1>
        <p className="start-description">Bewerten Sie zuerst jede Reflexion selbst in den drei Dimensionen Situationswahrnehmung, Ursachenanalyse und Handlungsalternativen. Danach sehen Sie drei verblindete Rückmeldungen: Entscheiden Sie für jede, ob Sie sie freigeben würden, und vergleichen Sie anschließend jeweils zwei Rückmeldungen miteinander.</p>
        <label className="annotator-field start-annotator">Pseudonyme Bewertungs-ID<input value={evaluatorId} onChange={event => setEvaluatorId(event.target.value)} placeholder="Ihr zugewiesener Code" autoComplete="off" disabled={busy} /></label>
        <FilePicker label="Evaluationspaket öffnen" accept="application/json,.json" onChange={event => void importBundle(event)} icon={<Upload size={18} />} primary />
        <p className="local-storage-note">Die Antworten werden nach jeder Auswahl lokal in diesem Browser gespeichert. Exportieren Sie eine Sitzungssicherung, bevor Sie das Gerät wechseln oder Browserdaten löschen.</p>
        <FilePicker label="Sitzungssicherung wiederherstellen" accept="application/json,.json" onChange={event => void restoreBackup(event)} icon={<Upload size={16} />} />
        <details className="pairwise-start-help"><summary>Kurzanleitung und Verblindung</summary><p>Jede Reflexion enthält drei Feedbacks mit stabilen Bezeichnungen A, B und C. Die Zuordnung und Reihenfolge werden vom Forschungsteam vorbereitet und ändern sich beim Fortsetzen nicht. Die experimentellen Bedingungen und frühere Bewertungen sind nicht Bestandteil des Evaluationspakets.</p><p>Pro Reflexion vergeben Sie zuerst drei Referenzwerte (0 bis 3 in Schritten von 0,5, Kommentar optional). Nach dem Abschluss sind diese Werte gesperrt; erst dann werden die Rückmeldungen angezeigt. Danach folgen drei Freigabeentscheidungen und drei Paarvergleiche. Bei einem Paarvergleich können Sie ausdrücklich „Keine wesentliche Präferenz“ wählen.</p></details>
      </section>
    </main> : activeCase && activeResponse ? <>
      <div className="pairwise-toolbar">
        <div><strong>{caseName}</strong><span>{completedCases} von {cases.length} Reflexionen abgeschlossen</span></div>
        <progress value={completedCases} max={Math.max(1, cases.length)} aria-label="Abgeschlossene Reflexionen" />
        <div className="pairwise-toolbar-actions">
          <span>{saveStatus === 'saved' ? 'Gespeichert' : saveStatus === 'saving' ? 'Speichert …' : saveStatus === 'error' ? 'Speicherfehler' : 'Entwurf'}</span>
          <button className="icon-button" onClick={() => downloadJson('prebi-pairwise-session-backup.json', session)}><Download size={16} />Stand exportieren</button>
          <button className="icon-button" onClick={() => downloadJson('prebi-pairwise-evaluation.json', researchExport(session))}><Download size={16} />Bewertungen exportieren</button>
          <button className="icon-button" onClick={() => { setSession(null); setError(''); setSaveStatus('idle') }}>Sitzung schließen</button>
        </div>
      </div>
      {saveError && <div className="pairwise-save-error" role="alert">{saveError}<button className="icon-button" onClick={() => setSaveAttempt(value => value + 1)}>Speicherung erneut versuchen</button></div>}
      <div className="pairwise-workspace">
        <section className="pairwise-reflection" aria-label="Reflexion und Fallfortschritt">
          <div className="pairwise-case-summary"><span>{caseName}</span><strong>{completion.decisions} von {completion.total} Entscheidungen abgeschlossen</strong></div>
          <SegmentSummaryPanel dimensions={activeCase.segment_summary.dimensions} title="Deskriptive Segmentinformationen" variant="pairwise" />
          <ReflectionViewer segments={activeCase.reflection.segments} humanAnnotations={activeCase.human_annotations} activeId={activeEvidence} scrollRef={reflectionRef} />
          <div className="pairwise-case-navigation">
            <button className="icon-button" onClick={() => navigate(activeIndex - 1)} disabled={activeIndex === 0}><ChevronLeft size={18} />Vorherige Reflexion</button>
            <span>{activeCase.reflection_id}</span>
            <button className="icon-button" onClick={() => navigate(activeIndex + 1)} disabled={activeIndex >= cases.length - 1}>Nächste Reflexion<ChevronRight size={18} /></button>
          </div>
        </section>
        <main className="pairwise-task-workspace">
          <div className="pairwise-task-tabs" role="tablist" aria-label="Bewertungsschritte">
            <button role="tab" aria-selected={task === 'reference'} className={task === 'reference' ? 'active' : ''} onClick={() => setTask('reference')}>0 · Referenzbewertung</button>
            <button role="tab" aria-selected={task === 'release'} className={task === 'release' ? 'active' : ''} disabled={!referenceConfirmed} onClick={() => setTask('release')}>1 · Freigabebereitschaft</button>
            <button role="tab" aria-selected={task === 'preference'} className={task === 'preference' ? 'active' : ''} disabled={!releaseComplete} onClick={() => setTask('preference')}>2 · Paarpräferenz</button>
          </div>
          {!releaseComplete && task === 'release' && <p className="pairwise-step-note">Bitte bewerten Sie alle drei Rückmeldungen, bevor Sie mit den Paarvergleichen beginnen.</p>}
          {task === 'reference' || !referenceConfirmed ? <PairwiseReferenceScoring
            reference={session!.input_bundle.reference_scoring}
            response={activeResponse}
            caseId={activeCase.case_id}
            onScore={(dimensionId, score) => updateReference((current, caseId) => setReferenceScore(current, caseId, dimensionId, score), 'Die Referenzbewertung konnte nicht gespeichert werden.')}
            onComment={(dimensionId, comment) => updateReference((current, caseId) => setReferenceComment(current, caseId, dimensionId, comment), 'Der Kommentar konnte nicht gespeichert werden.')}
            onConfirm={confirmReference}
          /> : task === 'release' ? <section className="pairwise-task-content" aria-labelledby="release-title">
            <h2 id="release-title">Freigabebereitschaft</h2>
            <p>Würden Sie diese Rückmeldung an die studierende Person weitergeben?</p>
            <div className="pairwise-candidate-tabs" role="tablist" aria-label="Feedback für Freigabeentscheidung">
              {labels.map(label => {
                const id = activeCase.display_order[label]
                const choice = activeResponse.release_readiness[id]
                return <button key={label} role="tab" aria-selected={candidateTab === label} className={candidateTab === label ? 'active' : ''} onClick={() => setCandidateTab(label)}>
                  <span>{candidateLabels[label]}</span><small>{choice ? 'Entscheidung vorhanden' : 'Noch offen'}</small>
                </button>
              })}
            </div>
            {(() => {
              const candidateId = activeCase.display_order[candidateTab]
              const candidate = candidateFor(activeCase, candidateId)
              return <div className="pairwise-release-panel" role="tabpanel" aria-label={`${candidateLabels[candidateTab]}: Freigabeentscheidung`}>
                <FeedbackText candidate={candidate} label={candidateLabels[candidateTab]} segments={activeCase.reflection.segments} activeEvidence={activeEvidence} onPreviewEvidence={setActiveEvidence} onActivateEvidence={activateEvidence} />
                <fieldset className="pairwise-choice-group">
                  <legend>Würden Sie diese Rückmeldung an die studierende Person weitergeben?</legend>
                  {([
                    ['ready', 'Ohne Änderungen freigeben'],
                    ['edit', 'Nach Bearbeitung freigeben'],
                    ['reject', 'Nicht freigeben'],
                  ] as const).map(([choice, text]) => <label key={choice} className={activeResponse.release_readiness[candidateId] === choice ? 'selected' : ''}>
                    <input type="radio" name={`release-${activeCase.case_id}-${candidateId}`} value={choice} checked={activeResponse.release_readiness[candidateId] === choice} onChange={() => updateRelease(candidateId, choice)} />
                    <span>{text}</span>
                  </label>)}
                </fieldset>
                {(activeResponse.release_readiness[candidateId] === 'edit' || activeResponse.release_readiness[candidateId] === 'reject') && <label className="pairwise-explanation">Was ist der wichtigste Grund für Ihre Entscheidung? <span>(optional)</span><textarea rows={3} value={activeResponse.explanations[candidateId] ?? ''} onChange={event => {
                  if (!session) return
                  try { setSession(setExplanation(session, activeCase.case_id, candidateId, event.target.value)) }
                  catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Begründung konnte nicht gespeichert werden.') }
                }} /></label>}
              </div>
            })()}
          </section> : <section className="pairwise-task-content" aria-labelledby="preference-title">
            <h2 id="preference-title">Paarpräferenz</h2>
            <p>Welche der beiden Rückmeldungen würden Sie der studierenden Person bevorzugt geben?</p>
            <div className="pairwise-pair-tabs" role="tablist" aria-label="Zu vergleichendes Feedbackpaar">
              {pairKeys.map(key => <button key={key} role="tab" aria-selected={pairTab === key} className={pairTab === key ? 'active' : ''} onClick={() => setPairTab(key)}>
                <span>{key.replace('-', '–')}</span><small>{activeResponse.pairwise_preferences[key] ? 'Entscheidung vorhanden' : 'Noch offen'}</small>
              </button>)}
            </div>
            {(() => {
              const [firstId, secondId] = pairCandidates(activeCase.display_order, pairTab)
              const [firstLabel, secondLabel] = pairTab.split('-') as [CandidateLabel, CandidateLabel]
              const preference = activeResponse.pairwise_preferences[pairTab]
              return <div className="pairwise-comparison-panel" role="tabpanel" aria-label={`Vergleich ${pairTab.replace('-', '–')}`}>
                <div className="pairwise-feedback-pair">
                  <FeedbackText candidate={candidateFor(activeCase, firstId)} label={candidateLabels[firstLabel]} segments={activeCase.reflection.segments} activeEvidence={activeEvidence} onPreviewEvidence={setActiveEvidence} onActivateEvidence={activateEvidence} />
                  <FeedbackText candidate={candidateFor(activeCase, secondId)} label={candidateLabels[secondLabel]} segments={activeCase.reflection.segments} activeEvidence={activeEvidence} onPreviewEvidence={setActiveEvidence} onActivateEvidence={activateEvidence} />
                </div>
                <fieldset className="pairwise-choice-group preference-options">
                  <legend>Welche der beiden Rückmeldungen würden Sie der studierenden Person bevorzugt geben?</legend>
                  <label className={preference === 'first' ? 'selected' : ''}><input type="radio" name={`preference-${activeCase.case_id}-${pairTab}`} checked={preference === 'first'} onChange={() => updatePreference(pairTab, 'first')} /><span>Feedback {firstLabel} bevorzugen</span></label>
                  <label className={preference === 'second' ? 'selected' : ''}><input type="radio" name={`preference-${activeCase.case_id}-${pairTab}`} checked={preference === 'second'} onChange={() => updatePreference(pairTab, 'second')} /><span>Feedback {secondLabel} bevorzugen</span></label>
                  <label className={preference === 'tie' ? 'selected' : ''}><input type="radio" name={`preference-${activeCase.case_id}-${pairTab}`} checked={preference === 'tie'} onChange={() => updatePreference(pairTab, 'tie')} /><span>Keine wesentliche Präferenz</span></label>
                </fieldset>
              </div>
            })()}
          </section>}
          <footer className="pairwise-task-footer">
            <span aria-live="polite">{completion.complete ? <><Check size={16} />Reflexion vollständig bewertet</> : `${completion.decisions} von ${completion.total} Entscheidungen abgeschlossen`}</span>
            <div>
              {task === 'reference' && referenceConfirmed && <button className="submit-button" onClick={() => setTask('release')}>Zur Freigabebereitschaft<ChevronRight size={16} /></button>}
              {task === 'release' && <button className="submit-button" disabled={!releaseComplete} onClick={() => setTask('preference')}>Zu den Paarvergleichen<ChevronRight size={16} /></button>}
              {task === 'preference' && <button className="icon-button" onClick={() => setTask('release')}><ChevronLeft size={16} />Freigabeentscheidungen ansehen</button>}
              {activeIndex < cases.length - 1 && <button className="icon-button" onClick={() => navigate(activeIndex + 1)}>Nächste Reflexion<ChevronRight size={16} /></button>}
            </div>
          </footer>
        </main>
      </div>
    </> : <div className="rating-empty"><strong>Keine Reflexion verfügbar</strong></div>}
  </AppShell>
}
