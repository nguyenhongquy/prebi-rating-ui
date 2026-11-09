import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AppShell } from './AppShell'
import { ReflectionViewer, EvidenceReferences, FeedbackHeading, scrollToEvidence } from './SourceComparison'
import {
  DIMENSIONS, CONDITIONS, CATEGORIES, MAX_BACKUP_BYTES, createLecturerSession, parseLecturerSession, setScore, confirmScores, reopenScores,
  beginAttempt, finishAttempt, bothSucceeded, choosePreference, startDraft, editDraft, reconfirmDraft, approveDraft, approvalCurrent,
  type LecturerSession, type LecturerItem, type Condition, type Preference, type Category,
} from './lecturerSession'
import { createFakeLecturerService, type LecturerService } from './lecturerService'
import { LecturerPersistence } from './lecturerPersistence'
import './LecturerWorkbench.css'

const steps = ['Vorbereiten', 'Bewerten', 'Vergleichen', 'Überarbeiten', 'Freigeben']
const preferenceLabels: Record<Preference, string> = { G1: 'G1 bevorzugt', G2: 'G2 bevorzugt', tie: 'Gleichwertig', neither: 'Beide ungeeignet' }
const categoryLabels: Record<Category, string> = { strengths: 'Stärke', weaknesses: 'Entwicklungspunkt', suggestions: 'Vorschlag' }
const statusLabels = { idle: 'Noch nicht angefragt', pending: 'Wird simuliert …', succeeded: 'Erfolgreich', failed: 'Fehlgeschlagen', interrupted: 'Unterbrochen / Ergebnis unbekannt' }
const message = (error: unknown) => error instanceof Error ? error.message : 'Die Aktion ist fehlgeschlagen. Exportieren Sie Ihre Arbeit und versuchen Sie es erneut.'
const newId = () => crypto.randomUUID()

export default function LecturerWorkbench({ service }: { service?: LecturerService }) {
  const defaultService = useRef(createFakeLecturerService())
  const client = service ?? defaultService.current
  const storage = useRef(new LecturerPersistence())
  const current = useRef<LecturerSession | null>(null)
  const generation = useRef(false)
  const [session, setSession] = useState<LecturerSession | null>(null)
  const [ready, setReady] = useState(false)
  const [loadFailure, setLoadFailure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Noch kein Fall')
  const [reviewed, setReviewed] = useState(false)
  const [failG2, setFailG2] = useState(false)
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const reflection = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const saveNumber = useRef(0)

  useEffect(() => {
    let active = true
    storage.current.load().then(saved => {
      if (!active) return
      current.current = saved
      setSession(saved)
      setSaveStatus(saved ? 'Lokaler Stand geladen' : 'Noch kein Fall')
      setReady(true)
    }).catch(caught => {
      if (active) {
        setSaveError(`${message(caught)} Der gespeicherte Stand wird nicht automatisch überschrieben. Stellen Sie eine gültige Sicherung wieder her oder löschen Sie den lokalen Demo-Fall ausdrücklich.`)
        setSaveStatus('Laden fehlgeschlagen')
        setLoadFailure(true)
        setReady(true)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => { heading.current?.focus(); setActiveEvidence(null) }, [step])
  useEffect(() => { setReviewed(false) }, [session?.revision])
  useEffect(() => {
    if (saveStatus !== 'Wird gespeichert …' && !saveError && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveStatus, saveError, busy])

  function persist(next: LecturerSession | null) {
    current.current = next
    setSession(next)
    setReviewed(false)
    const number = ++saveNumber.current
    setSaveStatus('Wird gespeichert …')
    void storage.current.save(next).then(() => {
      if (number === saveNumber.current) { setSaveStatus(next ? 'Lokal gespeichert' : 'Lokaler Stand gelöscht'); setSaveError(''); setLoadFailure(false) }
    }).catch(caught => {
      if (number === saveNumber.current) { setSaveStatus('Nicht gespeichert'); setSaveError(message(caught)) }
    })
  }
  function act(action: (value: LecturerSession) => LecturerSession) {
    try {
      if (!current.current) throw new Error('Öffnen Sie zuerst einen synthetischen Fall.')
      const next = action(current.current)
      if (next !== current.current) persist(next)
      setError('')
    } catch (caught) { setError(message(caught)) }
  }
  function download() {
    try {
      if (!current.current) throw new Error('Kein Fall zum Sichern vorhanden.')
      const data = parseLecturerSession(current.current, false)
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `prebi-synthetic-session-${data.id}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) { setError(message(caught)) }
  }
  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Die Sicherung überschreitet das Limit von 5 MB.')
      const restored = parseLecturerSession(JSON.parse(await file.text()))
      if ((current.current || loadFailure) && !window.confirm('Aktuellen lokalen Fall durch die Sicherung ersetzen? Nicht gesicherte oder unlesbare Arbeit geht verloren. Exportieren Sie sie bei Bedarf zuerst.')) return
      persist(restored)
      setStep(0)
      setError('')
    } catch (caught) { setError(message(caught)) }
    finally { setBusy(false) }
  }
  async function prepare() {
    if ((current.current || loadFailure) && !window.confirm('Neuen synthetischen Fall starten? Der gesamte aktuelle lokale Stand wird ersetzt. Exportieren Sie ihn bei Bedarf zuerst.')) return
    setBusy(true)
    try { persist(createLecturerSession(await client.prepare(), newId())); setStep(1); setError('') }
    catch (caught) { setError(message(caught)) }
    finally { setBusy(false) }
  }
  async function generate(only?: Condition) {
    if (generation.current || !current.current) return
    generation.current = true
    setBusy(true)
    setError('')
    const id = current.current.id
    const simulationClient = failG2 && !service ? createFakeLecturerService({ failOnce: ['G2'] }) : client
    setFailG2(false)
    try {
      for (const condition of only ? [only] : CONDITIONS) {
        if (!current.current || current.current.id !== id) break
        if (current.current.candidates[condition].status === 'succeeded') continue
        const attemptId = newId()
        const pending = beginAttempt(current.current, condition, attemptId)
        persist(pending)
        try {
          const result = await simulationClient.generate(structuredClone(pending.prepared), condition, attemptId)
          if (current.current) persist(finishAttempt(current.current, id, condition, attemptId, { result }))
        } catch (caught) {
          if (current.current) persist(finishAttempt(current.current, id, condition, attemptId, { error: message(caught) }))
        }
      }
    } catch (caught) { setError(message(caught)) }
    finally { generation.current = false; setBusy(false) }
  }
  function showEvidence(id: string) { setActiveEvidence(id); scrollToEvidence(reflection.current, id) }
  function links(item: LecturerItem) {
    return <EvidenceReferences ids={item.evidence} segments={session!.prepared.segments} selectedId={activeEvidence} onPreview={setActiveEvidence} onActivate={showEvidence} />
  }
  function updateItem(id: string, patch: Partial<LecturerItem>) {
    act(value => editDraft(value, value.draft!.items.map(item => item.id === id ? { ...item, ...patch } : item)))
  }
  function copyItem(condition: Condition, item: LecturerItem) {
    act(value => editDraft(value, [...value.draft!.items, { ...structuredClone(item), id: newId(), source: { candidateId: value.candidates[condition].result!.id, itemId: item.id } }]))
  }
  function allowed(index: number) {
    if (index === 0) return true
    if (!session) return false
    if (index === 1) return true
    if (index === 2) return Boolean(session.confirmedAt)
    if (index === 3) return Boolean(session.comparison)
    return Boolean(session.draft && session.comparison && session.draft.comparisonRevision === session.comparison.revision)
  }
  const draftCurrent = Boolean(session?.draft && session.comparison && session.draft.comparisonRevision === session.comparison.revision)
  const isApproved = session ? approvalCurrent(session) : false

  return <AppShell workflow="Lecturer generation">
    <main className="lecturer-workbench">
      <aside className="lecturer-demo" aria-label="Demohinweis"><strong>Synthetische Demo – keine echten Studierendendaten verwenden.</strong> Keine PDF-Verarbeitung, keine Modellinferenz, keine API- oder Provideraufrufe. Rubrik und Vorhersagen sind illustrativ. Freigabe ist keine Zustellung.</aside>
      <div className="lecturer-toolbar">
        <button disabled={!session} onClick={download}>Sitzung sichern</button>
        <input hidden ref={importRef} type="file" accept=".json,application/json" aria-label="Synthetische Sitzungssicherung" onChange={event => void restore(event)} />
        <button disabled={!ready || busy} onClick={() => importRef.current?.click()}>Sicherung wiederherstellen</button>
        <button disabled={!ready || (!session && !loadFailure) || busy} onClick={() => {
          if (window.confirm('Lokalen Demo-Fall einschließlich Entwurf und Freigaben endgültig löschen? Exportieren Sie vorher bei Bedarf eine Sicherung.')) { persist(null); setStep(0) }
        }}>Lokalen Fall löschen</button>
        <span role="status">{saveStatus}</span>
      </div>
      {saveError && <div role="alert" className="lecturer-error">{saveError} Sichern Sie den offenen Stand vor dem Schließen. <button onClick={() => { if (window.confirm('Seite neu laden? Nicht gespeicherte Änderungen gehen verloren.')) window.location.reload() }}>Seite neu laden</button></div>}
      {error && <p role="alert" className="lecturer-error">{error}</p>}
      <nav className="lecturer-steps" aria-label="Schritte der Feedbackerstellung">{steps.map((label, index) => <button key={label} disabled={!ready || busy || !allowed(index)} aria-current={index === step ? 'step' : undefined} onClick={() => { setStep(index); setError('') }}>{index + 1}. {label}</button>)}</nav>
      <h1 ref={heading} tabIndex={-1}>{steps[step]}</h1>
      {!ready && !saveError && <p role="status">Lokaler Stand wird geladen …</p>}
      {step === 0 && <section className="lecturer-card">
        <h2>Synthetischen Fall vorbereiten</h2>
        <p>Ein festes erfundenes Beispiel demonstriert den Ablauf. Es werden keine Dateien eingelesen. In diesem Browser wird genau ein Demo-Fall gespeichert; Sicherungen sind nur für diesen neuen Workflow bestimmt.</p>
        <p>Browserdaten können verloren gehen und sind auf gemeinsam genutzten Geräten nicht privat. Sichern Sie Ihre Arbeit und löschen Sie lokale Daten nach Gebrauch. Eine Sitzungssicherung enthält Reflexion, Bewertungen, Kandidaten, Entwurf und Freigaben; sie ist kein Studierendenexport.</p>
        <button disabled={!ready || busy || loadFailure} onClick={() => void prepare()}>{busy ? 'Vorbereitung läuft …' : session ? 'Neuen Demo-Fall starten' : 'Demo-Fall öffnen'}</button>
        {session && <p>Fall vorhanden. Nutzen Sie die Schritte oben zum Fortsetzen.</p>}
      </section>}
      {session && step > 0 && <div className="lecturer-columns">
        <div>
          <ReflectionViewer segments={session.prepared.segments} activeId={activeEvidence} scrollRef={reflection} />
          <details className="lecturer-card"><summary>Illustrative Vorhersagen (simuliert)</summary>{session.prepared.segments.map(segment => <p key={segment.segment_id}>Segment {segment.order + 1}: {DIMENSIONS.map(dimension => `${dimension} ${segment.prediction[dimension]}`).join(' · ')}</p>)}</details>
          <aside className="lecturer-card"><h2>Demo-Rubrik (schreibgeschützt)</h2><p>{session.prepared.rubric.guidance}</p><small>{session.prepared.rubric.id} / {session.prepared.rubric.version}</small></aside>
        </div>
        <section className="lecturer-card" aria-label={steps[step]}>
          {step === 1 && <>
            <p>Bewerten Sie die Reflexion unabhängig vom Feedback. Kandidaten werden hier nicht angezeigt. Bewertungen werden nicht an die Erzeugung übergeben.</p>
            {DIMENSIONS.map(dimension => <label className="lecturer-field" key={dimension}>{dimension}<select aria-label={`Bewertung ${dimension}`} disabled={Boolean(session.confirmedAt)} value={session.scores[dimension] ?? ''} onChange={event => act(value => setScore(value, dimension, event.target.value === '' ? null : Number(event.target.value)))}>
              <option value="">Bitte wählen</option>{[0, 0.5, 1, 1.5, 2, 2.5, 3].map(score => <option key={score} value={score}>{score.toLocaleString('de-DE')}</option>)}
            </select></label>)}
            {!session.confirmedAt ? <button disabled={DIMENSIONS.some(dimension => session.scores[dimension] === null)} onClick={() => act(value => confirmScores(value, new Date().toISOString()))}>Bewertungen bestätigen und sperren</button> : <>
              <p>Bewertungen bestätigt und gesperrt.</p>
              <button onClick={() => {
                if (window.confirm('Bewertungen erneut öffnen? Alle Kandidaten, Präferenzen, Entwürfe und Freigaben dieses Falls werden gelöscht. Sichern Sie den bisherigen Stand bei Bedarf zuerst.')) act(reopenScores)
              }}>Bewertungen erneut öffnen</button>
              <button onClick={() => setStep(2)}>Weiter zur Erzeugung</button>
            </>}
          </>}
          {step === 2 && <>
            <h2>G1 und G2 simulieren und vergleichen</h2>
            <p>Explizite Simulation, nacheinander G1 und G2. Beide müssen vorliegen. Eine Präferenz ist noch keine Freigabe.</p>
            {!bothSucceeded(session) && <>
              {!service && <label className="lecturer-check"><input type="checkbox" checked={failG2} disabled={busy} onChange={event => setFailG2(event.target.checked)} />Demo: nächsten G2-Aufruf fehlschlagen lassen</label>}
              <button disabled={busy} onClick={() => void generate()}>Fehlende Kandidaten simulieren</button>
            </>}
            <div className="lecturer-candidates">{CONDITIONS.map(condition => {
              const attempt = session.candidates[condition]
              return <article className="lecturer-candidate" key={condition}><h3>{condition}</h3><p role="status">{statusLabels[attempt.status]}</p>
                {attempt.error && <p role="alert">{attempt.error}</p>}
                {['failed', 'interrupted'].includes(attempt.status) && <button disabled={busy} onClick={() => void generate(condition)}>{condition} ausdrücklich erneut versuchen</button>}
                {bothSucceeded(session) && attempt.result?.items.map(item => <div key={item.id}><FeedbackHeading component={item.category} /><p>{item.text}</p>{links(item)}</div>)}
              </article>
            })}</div>
            {bothSucceeded(session) && <fieldset><legend>Erforderliche Präferenz</legend>{(Object.keys(preferenceLabels) as Preference[]).map(preference => <label className="lecturer-check" key={preference}><input type="radio" name="preference" value={preference} checked={session.comparison?.preference === preference} onChange={() => {
              if (session.draft && !window.confirm('Präferenz ändern? Der Entwurf bleibt erhalten, muss aber erneut bestätigt werden. Frühere Freigaben werden veraltet.')) return
              act(value => choosePreference(value, preference))
            }} />{preferenceLabels[preference]}</label>)}</fieldset>}
            {session.comparison && <button onClick={() => setStep(3)}>Weiter zum Entwurf</button>}
          </>}
          {step === 3 && <>
            <h2>Entwurf bearbeiten</h2>
            <p>Die Originalkandidaten bleiben unverändert. Die Präferenz legt die Entwurfsquelle nicht fest.</p>
            <div className="lecturer-actions">{(['G1', 'G2', 'blank'] as const).map(source => <button key={source} onClick={() => {
              if (session.draft && !window.confirm('Entwurf ersetzen? Frühere Freigaben bleiben als veraltet erhalten.')) return
              act(value => startDraft(value, source, newId))
            }}>{source === 'blank' ? 'Leeren Entwurf beginnen' : `Entwurf aus ${source}`}</button>)}</div>
            {session.draft && !draftCurrent && <div role="alert"><p>Die Präferenz wurde geändert. Prüfen und bestätigen Sie den bestehenden Entwurf erneut, bevor Sie weiterarbeiten.</p><button onClick={() => act(reconfirmDraft)}>Entwurf nach Präferenzänderung bestätigen</button></div>}
            {session.draft && <fieldset disabled={!draftCurrent}><legend>Feedbackeinträge</legend>
              {session.draft.items.map((item, index) => <article className="lecturer-edit-item" key={item.id}>
                <label className="lecturer-field">Kategorie {index + 1}<select value={item.category} onChange={event => updateItem(item.id, { category: event.target.value as Category })}>{CATEGORIES.map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
                <label className="lecturer-field">Feedback {index + 1}<textarea maxLength={20000} value={item.text} onChange={event => updateItem(item.id, { text: event.target.value })} /></label>
                <small>Herkunft: {item.source ? `Kandidat ${item.source.candidateId}, Eintrag ${item.source.itemId}` : 'Manuell'}</small>
                <fieldset><legend>Belege für Feedback {index + 1}</legend>{session.prepared.segments.map(segment => <label className="lecturer-check" key={segment.segment_id}><input type="checkbox" checked={item.evidence.includes(segment.segment_id)} onChange={event => updateItem(item.id, { evidence: event.target.checked ? [...item.evidence, segment.segment_id] : item.evidence.filter(id => id !== segment.segment_id) })} />Segment {segment.order + 1}</label>)}</fieldset>
                {!item.evidence.length && <p className="lecturer-warning">Ohne Beleg – vor Freigabe ausdrücklich prüfen.</p>}
                <button onClick={() => act(value => editDraft(value, value.draft!.items.filter(existing => existing.id !== item.id)))}>Feedback {index + 1} löschen</button>
              </article>)}
              <button onClick={() => act(value => editDraft(value, [...value.draft!.items, { id: newId(), category: 'suggestions', text: '', evidence: [], source: null }]))}>Manuellen Eintrag hinzufügen</button>
              <details><summary>Originaleinträge übernehmen</summary>{CONDITIONS.map(condition => <section key={condition}><h3>{condition}</h3>{session.candidates[condition].result!.items.map(item => <article key={item.id}><p>{item.text}</p>{links(item)}<button onClick={() => copyItem(condition, item)}>Aus {condition} übernehmen: {categoryLabels[item.category]}</button></article>)}</section>)}</details>
            </fieldset>}
            {draftCurrent && <button onClick={() => setStep(4)}>Weiter zur Prüfung</button>}
          </>}
          {step === 4 && session.draft && <>
            <h2>Review vor Freigabe</h2>
            <p>Präferenz: {session.comparison && preferenceLabels[session.comparison.preference]}. Prüfen Sie Text und Belege. Eine Freigabe sendet nichts und erzeugt keinen Studierendenexport.</p>
            {session.draft.items.map(item => <article className="lecturer-edit-item" key={item.id}><FeedbackHeading component={item.category} /><p>{item.text || '(Leerer Eintrag – nicht freigabefähig)'}</p>{links(item)}{!item.evidence.length && <p className="lecturer-warning">Ohne Beleg: menschliche Prüfung erforderlich.</p>}</article>)}
            {!session.draft.items.length && <p role="alert">Ein leerer Entwurf kann nicht freigegeben werden.</p>}
            <label className="lecturer-check"><input type="checkbox" checked={reviewed} disabled={isApproved} onChange={event => setReviewed(event.target.checked)} />Ich habe den aktuellen Text und alle Belege sowie unbelegte Aussagen geprüft.</label>
            <button disabled={!reviewed || isApproved || !session.draft.items.length || session.draft.items.some(item => !item.text.trim())} onClick={() => act(value => approveDraft(value, reviewed, new Date().toISOString()))}>Geprüften Stand freigeben</button>
            <p role="status">{isApproved ? 'Aktueller Stand freigegeben – nicht zugestellt.' : session.approvals.length ? 'Frühere Freigabe veraltet. Erneute Prüfung und Freigabe erforderlich.' : 'Noch nicht freigegeben.'}</p>
            {session.approvals.length > 0 && <details><summary>Freigabehistorie ({session.approvals.length})</summary>{session.approvals.map((approval, index) => <article key={index}><h3>{approval.approvedAt} – {isApproved && index === session.approvals.length - 1 ? 'aktuell' : 'veraltet'}</h3>{approval.draft.items.map(item => <p key={item.id}>{item.text}</p>)}</article>)}</details>}
          </>}
        </section>
      </div>}
    </main>
  </AppShell>
}
