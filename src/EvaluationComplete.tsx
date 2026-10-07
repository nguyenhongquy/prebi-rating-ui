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
    <h1 ref={headingRef} tabIndex={-1} id="completion-heading">{bundleComplete ? 'Evaluation complete' : 'Task complete'}</h1>
    {!bundleComplete && <p>{taskLabel}</p>}
    <ul className="completion-checks"><li><Check size={22} />{total} / {total} packets submitted</li><li><Check size={22} />{bundleComplete ? 'All required ratings complete' : 'All required ratings for this task complete'}</li></ul>
    <dl className="completion-tasks">{summaries.map(summary => <div key={summary.label}><dt>{summary.label}</dt><dd>{summary.complete} / {summary.total} submitted</dd></div>)}</dl>
    <div className="completion-actions"><button className="submit-button" onClick={onExport}><Download size={18} />{bundleComplete ? 'Export ratings' : 'Export task ratings'}</button>{!bundleComplete && <button className="icon-button" onClick={onContinue}><ChevronRight size={18} />Continue with next task</button>}<button className="icon-button" onClick={onReview}><ListChecks size={18} />Review ratings</button></div>
    <p>Responses remain stored locally in this browser. Export them for collection before clearing local data.</p>
  </section></main>
}