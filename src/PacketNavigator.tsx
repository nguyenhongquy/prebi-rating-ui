import { Check, ChevronLeft, ChevronRight, Circle, CircleDot } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CaseState } from './ratingValidation'
import './PacketNavigator.css'

export default function PacketNavigator({ label, states, activeIndex, onNavigate, children, review = false }: {
  label: string
  states: CaseState[]
  activeIndex: number
  onNavigate: (index: number) => void
  children: ReactNode
  review?: boolean
}) {
  const complete = states.filter(state => state === 'complete').length
  const started = states.filter(state => state === 'in_progress').length
  const labels: Record<CaseState, string> = { not_started: review ? 'Ungesehen' : 'Offen', in_progress: review ? 'Angesehen' : 'Begonnen', complete: review ? 'Mit Rückmeldung' : 'Abgeschlossen' }
  return <aside className="packet-rail" aria-label="Paketnavigation">
    <div className="rail-heading"><strong>{label}</strong></div>
    <p className="packet-position">Fall {activeIndex + 1} von {states.length}</p>
    {!review && <progress className="packet-completion-progress" value={complete} max={Math.max(1, states.length)} aria-label="Vollständig bewertete Fälle" />}
    <p className="packet-count">{review ? `${complete + started} von ${states.length} angesehen · ${complete} mit Rückmeldung` : `${complete} abgeschlossen · ${started} begonnen · ${states.length - complete - started} offen`}</p>
    <div className="packet-nav">
      <button className="icon-button" disabled={activeIndex === 0} onClick={() => onNavigate(activeIndex - 1)} aria-label="Vorheriger Fall" title="Vorheriger Fall"><ChevronLeft size={18} /></button>
      <button className="icon-button" disabled={activeIndex >= states.length - 1} onClick={() => onNavigate(activeIndex + 1)} aria-label="Nächster Fall" title="Nächster Fall"><ChevronRight size={18} /></button>
    </div>
    <nav aria-label="Fälle"><ol className="packet-list">
      {states.map((state, index) => {
        const Icon = state === 'complete' ? Check : state === 'not_started' ? Circle : CircleDot
        return <li key={index}><button aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Fall ${index + 1}, ${labels[state]}`} title={`Fall ${index + 1}: ${labels[state]}`} onClick={() => onNavigate(index)}><Icon size={16} /><span>{index + 1}</span></button></li>
      })}
    </ol></nav>
    <div className="packet-state-label" aria-live="polite">{labels[states[activeIndex] ?? 'not_started']}</div>
    {children}
  </aside>
}