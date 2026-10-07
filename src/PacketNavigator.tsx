import { Check, ChevronLeft, ChevronRight, Circle, Pencil, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PacketState } from './ratingValidation'
import './PacketNavigator.css'

export default function PacketNavigator({ label, states, activeIndex, onNavigate, children, review = false }: {
  label: string
  states: PacketState[]
  activeIndex: number
  onNavigate: (index: number) => void
  children: ReactNode
  review?: boolean
}) {
  const complete = states.filter(state => state === 'submitted').length
  const labels: Record<PacketState, string> = { not_started: 'Noch nicht begonnen', draft: 'Entwurf', changed: 'Änderungen ausstehend', submitted: review ? 'Freigegeben' : 'Abgeschlossen' }
  return <aside className="packet-rail" aria-label="Paketnavigation">
    <div className="rail-heading"><strong>{label}</strong></div>
    <p className="packet-position">Paket {activeIndex + 1} von {states.length}</p>
    <progress className="packet-completion-progress" value={complete} max={Math.max(1, states.length)} aria-label={review ? 'Pakete mit aktuellen Freigaben' : 'Pakete mit aktuellen abgeschlossenen Bewertungen'} />
    <p className="packet-count">{complete} / {states.length} aktuelle {review ? 'Freigaben' : 'Bewertungen'}</p>
    {!review && <p className="blind-note"><ShieldCheck size={14} />Bedingung und Modell sind ausgeblendet.</p>}
    <div className="packet-nav">
      <button className="icon-button" disabled={activeIndex === 0} onClick={() => onNavigate(activeIndex - 1)} aria-label="Vorheriges Paket" title="Vorheriges Paket"><ChevronLeft size={18} /></button>
      <button className="icon-button" disabled={activeIndex >= states.length - 1} onClick={() => onNavigate(activeIndex + 1)} aria-label="Nächstes Paket" title="Nächstes Paket"><ChevronRight size={18} /></button>
    </div>
    <nav aria-label="Pakete"><ol className="packet-list">
      {states.map((state, index) => {
        const Icon = state === 'submitted' ? Check : state === 'not_started' ? Circle : Pencil
        return <li key={index}><button aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Paket ${index + 1}, ${labels[state]}`} title={`Paket ${index + 1}: ${labels[state]}`} onClick={() => onNavigate(index)}><Icon size={16} /><span>{index + 1}</span></button></li>
      })}
    </ol></nav>
    <div className="packet-state-label" aria-live="polite">{labels[states[activeIndex] ?? 'not_started']}</div>
    {children}
  </aside>
}