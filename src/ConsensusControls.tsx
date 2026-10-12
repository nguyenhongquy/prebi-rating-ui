import { useState } from 'react'
import type { ConsensusCaseState, ConsensusHistoryEntry } from './ratingTypes'
import './ConsensusControls.css'

export default function ConsensusControls({ status, note, answerComplete, answerErrors, finalizedAt, finalizedBy, finalizationHistory, onNoteChange, onFlag, onResume, onFinalize, onReopen }: {
  status: ConsensusCaseState
  note: string
  answerComplete: boolean
  answerErrors: string[]
  finalizedAt: string | null
  finalizedBy: string | null
  finalizationHistory: ConsensusHistoryEntry[]
  onNoteChange: (value: string) => void
  onFlag: () => void
  onResume: () => void
  onFinalize: () => void
  onReopen: () => void
}) {
  const [showErrors, setShowErrors] = useState(false)
  const labels: Record<ConsensusCaseState, string> = { not_started: 'Noch nicht begonnen', in_progress: 'In Bearbeitung', flagged: 'Zur Klärung', finalized: 'Konsens erreicht' }
  return <section className="consensus-controls" aria-label="Gemeinsame Bewertung">
    <header><div><h2>Gemeinsame Bewertung</h2><span className={`consensus-status consensus-status-${status}`}>{labels[status]}</span></div><p className={answerComplete ? 'answers-complete' : 'answers-incomplete'}>{answerComplete ? 'Antworten vollständig' : 'Antworten noch unvollständig'}</p></header>
    <label className="field"><span>Diskussionsnotiz <small>Optional</small></span><textarea rows={3} value={note} disabled={status === 'finalized'} onChange={event => onNoteChange(event.target.value)} placeholder="Gemeinsame Auslegung oder offene Frage" /></label>
    {showErrors && answerErrors.length > 0 && <div className="consensus-errors" role="alert"><strong>Vor dem Bestätigen fehlen gültige Antworten:</strong><ul>{answerErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
    {status === 'finalized' ? <div className="consensus-finalized"><p role="status">Konsens erreicht{finalizedAt ? ` am ${new Date(finalizedAt).toLocaleString('de-DE')}` : ''}{finalizedBy ? ` · ${finalizedBy}` : ''}</p><button className="icon-button" onClick={onReopen}>Bearbeitung wieder öffnen</button></div> : <div className="consensus-actions">
      {status === 'flagged' ? <button className="icon-button" onClick={onResume}>In Bearbeitung setzen</button> : <button className="icon-button" onClick={onFlag}>Zur Klärung markieren</button>}
      <button className="submit-button" onClick={() => { setShowErrors(true); onFinalize() }}>Konsens bestätigen</button>
    </div>}
    {finalizationHistory.length > 0 && <details className="consensus-history"><summary>Frühere Finalisierungen ({finalizationHistory.length})</summary><ol>{finalizationHistory.map((entry, index) => <li key={`${entry.finalized_at}-${index}`}>{new Date(entry.finalized_at).toLocaleString('de-DE')} · {entry.finalized_by}</li>)}</ol></details>}
  </section>
}