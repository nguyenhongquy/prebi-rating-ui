import { useEffect, useRef } from 'react'
import { Check, ChevronRight, Download, ListChecks } from 'lucide-react'
import './PacketNavigator.css'

export default function EvaluationComplete({ bundleComplete, taskLabel, taskTotal, packetTotal, summaries, onExport, onReview, onContinue }: {
  bundleComplete: boolean
  taskLabel: string
  taskTotal: number
  packetTotal: number
  summaries: Array<{ label: string; total: number; complete: number }>
  onExport: () => void
  onReview: () => void
  onContinue: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [bundleComplete, taskLabel])
  const total = bundleComplete ? packetTotal : taskTotal
  return <main className="evaluation-complete"><section className="completion-content" aria-labelledby="completion-heading">
    <h1 ref={headingRef} tabIndex={-1} id="completion-heading">{bundleComplete ? 'Bewertung abgeschlossen' : 'Aufgabe abgeschlossen'}</h1>
    {!bundleComplete && <p>{taskLabel}</p>}
    <ul className="completion-checks"><li><Check size={22} />{total} / {total} Pakete abgeschlossen</li><li><Check size={22} />{bundleComplete ? 'Alle erforderlichen Bewertungen sind vollständig.' : 'Alle erforderlichen Bewertungen dieser Aufgabe sind vollständig.'}</li></ul>
    <dl className="completion-tasks">{summaries.map(summary => <div key={summary.label}><dt>{summary.label}</dt><dd>{summary.complete} / {summary.total} abgeschlossen</dd></div>)}</dl>
    <div className="completion-actions"><button className="submit-button" onClick={onExport}><Download size={18} />{bundleComplete ? 'Bewertungen exportieren' : 'Bewertungen dieser Aufgabe exportieren'}</button>{!bundleComplete && <button className="icon-button" onClick={onContinue}><ChevronRight size={18} />Nächste Aufgabe</button>}<button className="icon-button" onClick={onReview}><ListChecks size={18} />Bewertungen prüfen</button></div>
    <p>Ihre Antworten bleiben lokal in diesem Browser gespeichert. Exportieren Sie die Bewertungen, bevor Sie lokale Daten löschen.</p>
  </section></main>
}