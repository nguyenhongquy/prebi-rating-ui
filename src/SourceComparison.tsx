import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { ArrowUpRight, Lightbulb, Link, Sprout } from 'lucide-react'
import { componentLabels, type Packet, type Segment } from './ratingTypes'
import './SourceComparison.css'

export type FeedbackSelectionHandler = (event: SyntheticEvent<HTMLTextAreaElement>, component: string, index: number) => void

function SourceText({ text, label, onSelect }: {
  text: string
  label: string
  onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`
    }
    resize()
    let previousWidth = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== previousWidth) {
        previousWidth = element.clientWidth
        resize()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  return <textarea ref={textRef} className="source-text" readOnly rows={2} value={text} aria-label={label} onSelect={onSelect} />
}

type EvidenceInteraction = {
  selectedId: string | null
  selectedIds?: string[]
  onShow?: () => void
  onPreview: (id: string | null) => void
  onActivate: (id: string) => void
}

export function EvidenceReferences({ ids, segments, selectedId, selectedIds, onShow, onPreview, onActivate }: EvidenceInteraction & { ids: string[]; segments: Segment[] }) {
  const segmentNumbers = new Map(segments.map(segment => [segment.segment_id, segment.order + 1]))
  return <div className="evidence-references">
    {onShow && ids.length > 0 ? <button className="evidence-show" onClick={onShow}><Link size={14} />Beleg anzeigen</button> : <span>Belege:</span>}
    {ids.length ? ids.map((id, index) => {
      const number = segmentNumbers.get(id)
      return number === undefined ? <span className="unavailable-evidence" key={`${id}-${index}`}>Beleg nicht verfügbar</span> : <button key={`${id}-${index}`} className="evidence-reference" aria-label={`Reflexionssegment ${number} anzeigen`} aria-pressed={selectedIds?.includes(id) ?? selectedId === id} title={`Reflexionssegment ${number}`} onMouseEnter={() => onPreview(id)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(id)} onBlur={() => onPreview(null)} onClick={() => onActivate(id)}>{number}</button>
    }) : <span>Keine Belege angegeben</span>}
  </div>
}

export function FeedbackHeading({ component }: { component: keyof typeof componentLabels }) {
  const Icon = component === 'strengths' ? Sprout : component === 'weaknesses' ? ArrowUpRight : Lightbulb
  return <h3 className={`feedback-heading feedback-${component}`}><Icon size={17} aria-hidden="true" />{componentLabels[component]}</h3>
}

export function ComparisonWorkspace({ reflection, children }: { reflection: ReactNode; children: ReactNode }) {
  return <div className="comparison-area">{reflection}<div className="workspace-review">{children}</div></div>
}

export function scrollToEvidence(container: HTMLDivElement | null, id: string) {
  const segment = container && Array.from(container.children).find(element => element.getAttribute('data-segment-id') === id)
  if (!container || !segment) return
  const containerBounds = container.getBoundingClientRect()
  const segmentBounds = segment.getBoundingClientRect()
  if (segmentBounds.top < containerBounds.top || segmentBounds.bottom > containerBounds.bottom) {
    container.scrollTop += segmentBounds.top - containerBounds.top - 16
  }
  if (containerBounds.bottom <= 0 || containerBounds.top >= window.innerHeight) container.scrollIntoView({ block: 'start' })
}

export function ReflectionViewer({ segments, activeId, activeIds = [], scrollRef, evidenceSelection }: { segments: Segment[]; activeId: string | null; activeIds?: string[]; scrollRef: RefObject<HTMLDivElement | null>; evidenceSelection?: { ids: string[]; onToggle: (id: string) => void; label: string } }) {
  return <section className="source-panel" aria-label="Reflexion">
    <div className="panel-title"><h2>Reflexion</h2><small>{segments.length} {segments.length === 1 ? 'Segment' : 'Segmente'}</small></div>
    <div ref={scrollRef} className="source-scroll segments" tabIndex={0} aria-label="Reflexionssegmente">
      {segments.map(segment => <article className={`segment${activeId === segment.segment_id || activeIds.includes(segment.segment_id) || evidenceSelection?.ids.includes(segment.segment_id) ? ' evidence-highlight' : ''}`} key={segment.segment_id} data-segment-id={segment.segment_id} aria-label={`Reflexionssegment ${segment.order + 1}${activeId === segment.segment_id || activeIds.includes(segment.segment_id) ? ', hervorgehobener Beleg' : ''}`}>
        {evidenceSelection ? <label className="segment-evidence-choice"><input type="checkbox" aria-label={`Segment ${segment.order + 1} als Beleg für ${evidenceSelection.label}`} checked={evidenceSelection.ids.includes(segment.segment_id)} onChange={() => evidenceSelection.onToggle(segment.segment_id)} /><span>{segment.order + 1}</span></label> : <span className="segment-id">{segment.order + 1}</span>}<p>{segment.text}</p>
      </article>)}
    </div>
  </section>
}

export function OutputViewer({ packet, onSelection, evidence, selectedItem, onShowItem }: { packet: Packet; onSelection: FeedbackSelectionHandler; evidence: EvidenceInteraction; selectedItem?: string | null; onShowItem?: (key: string, ids: string[]) => void }) {
  const title = packet.task === 'assessment_quality' ? 'Generierte Einschätzung' : packet.task === 'feedback_quality' ? 'Generiertes Feedback' : 'Menschliches Feedback'
  return <section className="source-panel output-panel" aria-label={title}>
    <div className="panel-title"><h2>{title}</h2></div>
    <div className="source-scroll" tabIndex={0} aria-label={title + ' · Text'}>
      {packet.task === 'assessment_quality' ? <div className="assessment-output">{packet.output?.dimensions?.map(dimension => <article className={`assessment-dimension${selectedItem === dimension.dimension_id ? ' selected-feedback' : ''}`} key={dimension.dimension_id}>
        <header><strong>{dimension.dimension_id}</strong><span>Punktwert {dimension.score.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></header>
        <p>{dimension.justification}</p><EvidenceReferences ids={dimension.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => onShowItem?.(dimension.dimension_id, dimension.evidence_segment_ids)} onActivate={id => { onShowItem?.(dimension.dimension_id, dimension.evidence_segment_ids); evidence.onActivate(id) }} />
      </article>)}</div> : packet.task === 'feedback_quality' ? <div className="feedback-output">{(['strengths', 'weaknesses', 'suggestions'] as const).map(component => <section className="feedback-component" key={component}>
        <FeedbackHeading component={component} />
        {(packet.output?.[component] ?? []).length ? packet.output?.[component]?.map((item, index) => <div className={`feedback-item${selectedItem === `${component}-${index}` ? ' selected-feedback' : ''}`} key={`${component}-${index}`}>
          <SourceText text={item.text} label={`${componentLabels[component]} ${index + 1}`} onSelect={event => onSelection(event, component, index)} />
          <EvidenceReferences ids={item.evidence_segment_ids ?? []} segments={packet.reflection.segments} {...evidence} onShow={() => onShowItem?.(`${component}-${index}`, item.evidence_segment_ids ?? [])} onActivate={id => { onShowItem?.(`${component}-${index}`, item.evidence_segment_ids ?? []); evidence.onActivate(id) }} />
        </div>) : <p className="empty-component">Keine Einträge in diesem Abschnitt.</p>}
      </section>)}</div> : <SourceText text={packet.human_feedback ?? ''} label="Menschliches Feedback" onSelect={event => onSelection(event, 'human_feedback', 0)} />}
    </div>
  </section>
}

export default function SourceComparison({ packet, onSelection, children }: { packet: Packet; onSelection: FeedbackSelectionHandler; children?: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  function activateEvidence(id: string) {
    setSelectedId(id)
    scrollToEvidence(scrollRef.current, id)
  }
  function showItem(key: string, ids: string[]) {
    setSelectedItem(key)
    setSelectedIds(ids)
    setPreviewId(null)
    setSelectedId(null)
    if (ids[0]) scrollToEvidence(scrollRef.current, ids[0])
  }
  return <ComparisonWorkspace reflection={<ReflectionViewer segments={packet.reflection.segments} activeId={previewId ?? selectedId} activeIds={selectedIds} scrollRef={scrollRef} />}>
    <OutputViewer packet={packet} onSelection={onSelection} selectedItem={selectedItem} onShowItem={showItem} evidence={{ selectedId, selectedIds, onPreview: setPreviewId, onActivate: activateEvidence }} />
    {children}
  </ComparisonWorkspace>
}