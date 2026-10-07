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
  const labels: Record<PacketState, string> = { not_started: 'Not started', draft: 'Draft', changed: 'Changes pending', submitted: review ? 'Approved' : 'Submitted' }
  return <aside className="packet-rail" aria-label="Packet navigation">
    <div className="rail-heading"><strong>{label}</strong></div>
    <p className="packet-position">Packet {activeIndex + 1} of {states.length}</p>
    <progress className="packet-completion-progress" value={complete} max={Math.max(1, states.length)} aria-label={review ? 'Packets with current approvals' : 'Packets with current submitted ratings'} />
    <p className="packet-count">{complete} / {states.length} current {review ? 'approvals' : 'submissions'}</p>
    {!review && <p className="blind-note"><ShieldCheck size={14} />Condition and model are hidden.</p>}
    <div className="packet-nav">
      <button className="icon-button" disabled={activeIndex === 0} onClick={() => onNavigate(activeIndex - 1)} aria-label="Previous packet" title="Previous packet"><ChevronLeft size={18} /></button>
      <button className="icon-button" disabled={activeIndex >= states.length - 1} onClick={() => onNavigate(activeIndex + 1)} aria-label="Next packet" title="Next packet"><ChevronRight size={18} /></button>
    </div>
    <nav aria-label="Packets"><ol className="packet-list">
      {states.map((state, index) => {
        const Icon = state === 'submitted' ? Check : state === 'not_started' ? Circle : Pencil
        return <li key={index}><button aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Packet ${index + 1}, ${labels[state]}`} title={`Packet ${index + 1}: ${labels[state]}`} onClick={() => onNavigate(index)}><Icon size={16} /><span>{index + 1}</span></button></li>
      })}
    </ol></nav>
    <div className="packet-state-label" aria-live="polite">{labels[states[activeIndex] ?? 'not_started']}</div>
    {children}
  </aside>
}