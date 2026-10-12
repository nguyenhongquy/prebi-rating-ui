import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Circle, CircleDot, Flag } from 'lucide-react'
import type { CaseState } from './ratingValidation'
import type { ConsensusCaseState } from './ratingTypes'
import { filteredConsensusIndexes } from './expertSession'
import './PacketNavigator.css'

type CaseFilter = 'all' | 'open' | 'flagged' | 'finalized'

export default function PacketNavigator({ label, states, activeIndex, onNavigate, children, review = false, consensusMode = false, consensusStatuses }: {
  label: string
  states: CaseState[]
  activeIndex: number
  onNavigate: (index: number) => void
  children: ReactNode
  review?: boolean
  consensusMode?: boolean
  consensusStatuses?: ConsensusCaseState[]
}) {
  const [filter, setFilter] = useState<CaseFilter>('all')
  const complete = states.filter(state => state === 'complete').length
  const started = states.filter(state => state === 'in_progress').length
  const labels: Record<CaseState, string> = { not_started: review ? 'Ungesehen' : 'Offen', in_progress: review ? 'Angesehen' : 'Begonnen', complete: review ? 'Mit Rückmeldung' : 'Abgeschlossen' }
  const consensusCounts = {
    not_started: consensusStatuses?.filter(state => state === 'not_started').length ?? 0,
    in_progress: consensusStatuses?.filter(state => state === 'in_progress').length ?? 0,
    flagged: consensusStatuses?.filter(state => state === 'flagged').length ?? 0,
    finalized: consensusStatuses?.filter(state => state === 'finalized').length ?? 0,
  }
  const consensusLabels: Record<ConsensusCaseState, string> = { not_started: 'Nicht begonnen', in_progress: 'In Bearbeitung', flagged: 'Zur Klärung', finalized: 'Konsens erreicht' }
  const visibleIndexes = consensusMode && consensusStatuses
    ? filteredConsensusIndexes(consensusStatuses, filter, activeIndex)
    : states.map((_, index) => index)
  const visiblePosition = Math.max(0, visibleIndexes.indexOf(activeIndex))
  const activeOutsideFilter = consensusMode && filter !== 'all' && consensusStatuses?.[activeIndex] !== undefined
    && (filter === 'open' ? consensusStatuses[activeIndex] === 'finalized' : filter === 'flagged' ? consensusStatuses[activeIndex] !== 'flagged' : consensusStatuses[activeIndex] !== 'finalized')
  return <aside className="packet-rail" aria-label="Paketnavigation">
    <div className="rail-heading"><strong>{label}</strong></div>
    <p className="packet-position">Fall {activeIndex + 1} von {states.length}</p>
    {!review && <progress className="packet-completion-progress" value={consensusMode ? consensusCounts.finalized : complete} max={Math.max(1, states.length)} aria-label={consensusMode ? 'Konsens finalisierte Fälle' : 'Vollständig bewertete Fälle'} />}
    <p className="packet-count">{consensusMode ? `${consensusCounts.finalized} Konsens erreicht · ${consensusCounts.in_progress} in Bearbeitung · ${consensusCounts.flagged} zur Klärung · ${consensusCounts.not_started} nicht begonnen` : review ? `${complete + started} von ${states.length} angesehen · ${complete} mit Rückmeldung` : `${complete} abgeschlossen · ${started} begonnen · ${states.length - complete - started} offen`}</p>
    {consensusMode && <label className="case-filter">Fälle anzeigen<select value={filter} onChange={event => setFilter(event.target.value as CaseFilter)} aria-label="Fälle filtern"><option value="all">Alle Fälle</option><option value="open">Offen</option><option value="flagged">Zur Klärung</option><option value="finalized">Konsens erreicht</option></select></label>}
    <div className="packet-nav">
      <button className="icon-button" disabled={visiblePosition === 0} onClick={() => onNavigate(visibleIndexes[visiblePosition - 1])} aria-label="Vorheriger Fall" title="Vorheriger Fall"><ChevronLeft size={18} /></button>
      <button className="icon-button" disabled={visiblePosition >= visibleIndexes.length - 1} onClick={() => onNavigate(visibleIndexes[visiblePosition + 1])} aria-label="Nächster Fall" title="Nächster Fall"><ChevronRight size={18} /></button>
    </div>
    {activeOutsideFilter && <p className="active-filter-note">Aktiver Fall {activeIndex + 1} bleibt geöffnet, obwohl er nicht zum Filter gehört.</p>}
    <nav aria-label="Fälle"><ol className="packet-list">
      {visibleIndexes.map(index => {
        const state = states[index]
        const consensusState = consensusStatuses?.[index] ?? 'not_started'
        const Icon = consensusMode ? consensusState === 'finalized' ? Check : consensusState === 'flagged' ? Flag : consensusState === 'not_started' ? Circle : CircleDot : state === 'complete' ? Check : state === 'not_started' ? Circle : CircleDot
        const stateLabel = consensusMode ? consensusLabels[consensusState] : labels[state]
        return <li key={index}><button className={consensusMode ? `consensus-case consensus-${consensusState}` : ''} aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Fall ${index + 1}, ${stateLabel}${consensusMode && state === 'complete' && consensusState !== 'finalized' ? ', Antworten vollständig' : ''}`} title={`Fall ${index + 1}: ${stateLabel}`} onClick={() => onNavigate(index)}><Icon size={16} /><span>{index + 1}</span></button></li>
      })}
    </ol></nav>
    <div className="packet-state-label" aria-live="polite">{consensusMode ? `${consensusLabels[consensusStatuses?.[activeIndex] ?? 'not_started']}${states[activeIndex] === 'complete' && consensusStatuses?.[activeIndex] !== 'finalized' ? ' · Antworten vollständig' : ''}` : labels[states[activeIndex] ?? 'not_started']}</div>
    {children}
  </aside>
}