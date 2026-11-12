import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { AppShell } from './AppShell'
import { ComparisonWorkspace, EvidenceReferences, FeedbackHeading, ReflectionViewer, scrollToEvidence } from './SourceComparison'
import { generateG1, makeG1Document, splitReflectionSegments, type G1Result } from './g1Api'
import './G1Workbench.css'

const synthesisFields = [
  ['demonstrated_depth', 'Gezeigte Reflexionstiefe'],
  ['development', 'Ausarbeitung und Begründung'],
  ['integrative_coherence', 'Zusammenhänge'],
  ['limitations', 'Grenzen'],
  ['uncertainty', 'Unsicherheit'],
] as const
const feedbackFields = ['strengths', 'weaknesses', 'suggestions'] as const

export default function G1Workbench() {
  const [text, setText] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<G1Result | null>(null)
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<string | null>(null)
  const reflectionRef = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController | null>(null)
  const segments = splitReflectionSegments(text)

  useEffect(() => () => { request.current?.abort() }, [])
  useEffect(() => {
    if (!text && !result && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [text, result, busy])

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    if (!reviewed || !authorized) { setError('Bestätigen Sie die Segmentierung und die autorisierte externe Verarbeitung.'); return }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const document = makeG1Document(segments, crypto.randomUUID())
      const next = await generateG1(document, controller.signal)
      if (!controller.signal.aborted) { setResult(next); setActiveEvidence(null); setPreviewEvidence(null) }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Die G1-Erzeugung ist fehlgeschlagen.')
    } finally {
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function download() {
    if (!result) return
    try {
      const url = URL.createObjectURL(new Blob([result.raw], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'prebi-g1-response.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('Die JSON-Antwort konnte nicht heruntergeladen werden.')
    }
  }

  function evidence(ids: string[]) {
    if (!result) return null
    return <EvidenceReferences ids={ids} segments={result.document.segments} selectedId={previewEvidence ?? activeEvidence} onPreview={setPreviewEvidence} onActivate={id => { setActiveEvidence(id); scrollToEvidence(reflectionRef.current, id) }} />
  }

  return <AppShell workflow="G1 generation">
    <main className="g1-workbench">
      <h1>G1 Feedback erstellen</h1>
      <p className="g1-notice"><strong>Externe Verarbeitung:</strong> Der lokale G1-Dienst übermittelt die Reflexion an Google Gemini. Verwenden Sie nur dafür freigegebene Daten. Das Ergebnis ist automatisch erzeugt und muss fachlich geprüft werden.</p>
      <form className="g1-card" onSubmit={generate}>
        <label className="g1-field">Deutsche Reflexion
          <textarea value={text} disabled={busy} onChange={event => { setText(event.target.value); setReviewed(false); setAuthorized(false) }} rows={9} placeholder="Reflexion hier eingeben oder einfügen" />
        </label>
        <p>Ein Punkt mit anschließendem Zeilenumbruch trennt die Segmente; häufige Abkürzungen und Dezimalzahlen werden nach Möglichkeit geschützt. Ein Punkt ohne Zeilenumbruch oder ein Zeilenumbruch ohne Punkt trennt nicht. Führende und abschließende Leerzeichen je Segment werden entfernt. Prüfen Sie die Grenzen: Die Belege im Ergebnis beziehen sich auf diese Segmente.</p>
        {segments.length > 0 && <section aria-labelledby="g1-segments-heading">
          <h2 id="g1-segments-heading">Segmente prüfen ({segments.length})</h2>
          <ol className="g1-segments">{segments.map((segment, index) => <li key={index}>{segment}</li>)}</ol>
          <label className="g1-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />Ich habe die Segmentgrenzen geprüft.</label>
        </section>}
        <label className="g1-check"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} />Ich bestätige, dass diese Reflexion für die externe Verarbeitung durch Google Gemini freigegeben ist.</label>
        <button className="g1-primary" type="submit" disabled={busy || !segments.length || !reviewed || !authorized}>Feedback generieren</button>
        {busy && <p role="status">Feedback wird generiert … Dies kann einige Zeit dauern.</p>}
      </form>
      {error && <p className="g1-error" role="alert">{error}</p>}
      {result && <section aria-labelledby="g1-result-heading">
        <div className="g1-result-header"><div><h2 id="g1-result-heading">G1-Ergebnis</h2><p>Die angezeigte Reflexion ist die zur letzten erfolgreichen Anfrage gesendete Fassung.</p></div><button type="button" onClick={download}><Download size={17} />Original-JSON herunterladen</button></div>
        <ComparisonWorkspace reflection={<ReflectionViewer segments={result.document.segments} activeId={previewEvidence ?? activeEvidence} scrollRef={reflectionRef} />}>
          <div className="g1-output">
            <section className="g1-card"><h2>Evidenzsynthese</h2>
              {result.output.evidence_synthesis.map(dimension => <section className="g1-dimension" key={dimension.dimension_id}><h3>{dimension.dimension_id}</h3>
                {synthesisFields.map(([field, label]) => <section key={field}><h4>{label}</h4>
                  {dimension[field].length ? dimension[field].map((claim, index) => <article key={index}><p>{claim.interpretation}</p>{evidence(claim.evidence_refs)}</article>) : <p>Keine Einträge.</p>}
                </section>)}
              </section>)}
            </section>
            <section className="g1-card"><h2>Einschätzung</h2>
              {result.output.assessment.component_assessments.map(item => <article className="g1-dimension" key={item.dimension_id}>
                <h3>{item.dimension_id} · {item.band.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</h3>
                <p>{item.justification}</p>
                {item.intermediate_score_explanation !== null && <p><strong>Einordnung des Zwischenwerts: </strong>{item.intermediate_score_explanation}</p>}
                {evidence(item.evidence_segment_ids)}
              </article>)}
            </section>
            <section className="g1-card"><h2>Feedback</h2>
              {feedbackFields.map(field => <section className="g1-dimension" key={field}><FeedbackHeading component={field} />
                {result.output.feedback[field].length ? result.output.feedback[field].map((item, index) => <article key={index}><p>{item.message}</p>{evidence(item.evidence_segment_ids)}</article>) : <p>Keine Einträge.</p>}
              </section>)}
            </section>
            <details className="g1-card"><summary>Original-JSON anzeigen</summary><pre>{result.raw}</pre></details>
          </div>
        </ComparisonWorkspace>
      </section>}
      <p>Die Eingabe und das Ergebnis werden in diesem Arbeitsbereich nicht gespeichert. Laden Sie das JSON vor dem Verlassen herunter; es enthält nur die Antwort, nicht die Reflexion.</p>
    </main>
  </AppShell>
}
