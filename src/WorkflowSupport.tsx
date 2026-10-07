import { Check, Download, HelpCircle, LoaderCircle, X } from 'lucide-react'
import './WorkflowSupport.css'

export function PersistenceStatus({ state }: { state: 'saving' | 'saved' | 'error' | 'idle' }) {
  return <span className="persistence-status" role="status">{state === 'saved' ? <Check size={15} /> : state === 'saving' ? <LoaderCircle size={15} /> : null}{state === 'saved' ? 'Lokal gespeichert' : state === 'saving' ? 'Wird lokal gespeichert …' : state === 'error' ? 'Nicht lokal gespeichert · bitte exportieren' : 'Noch keine Änderungen'}</span>
}

export function WorkflowHelp({ review = false }: { review?: boolean }) {
  return <details className="workflow-help"><summary><HelpCircle size={16} />So funktioniert’s</summary>
    <h2>{review ? 'Feedback prüfen' : 'Bewertung'}</h2>
    <p>{review ? 'Prüfen Sie das generierte Feedback aus Ihrer Perspektive als Lehrende.' : 'Bewerten Sie die Fälle anhand des jeweils angezeigten Bewertungsprotokolls.'}</p>
    <ul><li>Sie müssen nicht alle Fälle in einer Sitzung bearbeiten.</li><li>Ihr Bearbeitungsstand wird automatisch lokal gespeichert. Unvollständige Fälle können Sie später fortsetzen und bereits bearbeitete Fälle ändern.</li>
      {review ? <li>Bestätigen Sie Feedback mit „Passt“, markieren Sie Probleme oder ergänzen Sie eigene Hinweise. „Beleg anzeigen“ zeigt die zugrunde liegenden Reflexionsstellen.</li> : <li>„Nicht beurteilbar“ ist eine eigenständige Antwort und keine niedrige Bewertung. Geben Sie dazu eine Begründung an.</li>}
    </ul>
    <h3>Speicherung und Sicherung</h3><p>Der Stand bleibt nur in diesem Browser auf diesem Gerät. Es gibt keine Anmeldung, Serverübertragung oder Cloud-Synchronisierung. Auf anderen Geräten wird Ihr Stand nicht automatisch wiederhergestellt. Das Löschen von Browser- oder Websitedaten kann ihn entfernen.</p>
    <p>Exportieren Sie den Bearbeitungsstand als Sicherung oder zum Übertragen auf ein anderes Gerät. Dort können Sie die exportierte Datei wieder öffnen. Die Anwendung ist derzeit nicht für einen zuverlässigen Offline-Start eingerichtet.</p>
  </details>
}

export function ResumePrompt({ count, total, onContinue, onRestart, onCancel, review = false }: { count: number; total: number; onContinue: () => void; onRestart: () => void; onCancel: () => void; review?: boolean }) {
  return <section className="workflow-prompt" aria-labelledby="resume-heading"><h2 id="resume-heading">{review ? 'Feedbackprüfung fortsetzen' : 'Bewertung fortsetzen'}</h2><p>Für dieses Paket wurde ein Bearbeitungsstand gefunden.</p><p>{count} von {total} Fällen wurden bereits {review ? 'angesehen' : 'bearbeitet'}.</p><div className="workflow-actions"><button className="submit-button" onClick={onContinue}>Fortsetzen</button><button className="icon-button" onClick={onRestart}>Neu beginnen</button><button className="icon-button" onClick={onCancel}>Abbrechen</button></div></section>
}

export function ExportSummary({ total, complete, started, onExport, onClose, review = false, feedback = 0 }: { total: number; complete: number; started: number; onExport: () => void; onClose: () => void; review?: boolean; feedback?: number }) {
  return <section className="workflow-prompt" aria-labelledby="export-heading"><div className="panel-title"><h2 id="export-heading">{review ? 'Prüfungsstand' : 'Bewertungsstand'}</h2><button className="icon-button" aria-label="Exportübersicht schließen" title="Schließen" onClick={onClose}><X size={16} /></button></div>
    <p>{total} Fälle insgesamt</p>{review ? <p>{started} angesehen · {feedback} mit Rückmeldung</p> : <p>{complete} abgeschlossen · {started} begonnen · {total - complete - started} offen</p>}
    <button className="submit-button" onClick={onExport}><Download size={17} />{review ? 'Prüfungsstand exportieren' : 'Ergebnisse exportieren'}</button>
  </section>
}