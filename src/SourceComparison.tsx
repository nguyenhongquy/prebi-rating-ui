import { useLayoutEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react'
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
  onPreview: (id: string | null) => void
  onActivate: (id: string) => void
}

export function EvidenceReferences({ ids, segments, selectedId, onPreview, onActivate }: EvidenceInteraction & { ids: string[]; segments: Segment[] }) {
  const segmentNumbers = new Map(segments.map(segment => [segment.segment_id, segment.order + 1]))
  return <div className="evidence-references">
    <span>Evidence:</span>
    {ids.length ? ids.map((id, index) => {
      const number = segmentNumbers.get(id)
      return number === undefined ? <span className="unavailable-evidence" key={`${id}-${index}`}>Unavailable reference</span> : <button key={`${id}-${index}`} className="evidence-reference" aria-label={`Show reflection segment ${number}`} aria-pressed={selectedId === id} title={`Reflection segment ${number}`} onMouseEnter={() => onPreview(id)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(id)} onBlur={() => onPreview(null)} onClick={() => onActivate(id)}>{number}</button>
    }) : <span>None cited</span>}
  </div>
}

export function ReflectionViewer({ segments, activeId, scrollRef, evidenceSelection }: { segments: Segment[]; activeId: string | null; scrollRef: RefObject<HTMLDivElement | null>; evidenceSelection?: { ids: string[]; onToggle: (id: string) => void; label: string } }) {
  return <section className="source-panel" aria-label="Reflection">
    <div className="panel-title"><h2>Reflection</h2><small>{segments.length} segments</small></div>
    <div ref={scrollRef} className="source-scroll segments" tabIndex={0} aria-label="Reflection segments">
      {segments.map(segment => <article className={`segment${activeId === segment.segment_id || evidenceSelection?.ids.includes(segment.segment_id) ? ' evidence-highlight' : ''}`} key={segment.segment_id} data-segment-id={segment.segment_id} aria-label={`Reflection segment ${segment.order + 1}${activeId === segment.segment_id ? ', highlighted evidence' : ''}`}>
        {evidenceSelection ? <label className="segment-evidence-choice"><input type="checkbox" aria-label={`Segment ${segment.order + 1} evidence for ${evidenceSelection.label}`} checked={evidenceSelection.ids.includes(segment.segment_id)} onChange={() => evidenceSelection.onToggle(segment.segment_id)} /><span>{segment.order + 1}</span></label> : <span className="segment-id">{segment.order + 1}</span>}<p>{segment.text}</p>
      </article>)}
    </div>
  </section>
}

export function OutputViewer({ packet, onSelection, evidence }: { packet: Packet; onSelection: FeedbackSelectionHandler; evidence: EvidenceInteraction }) {
  const title = packet.task === 'assessment_quality' ? 'Assessment output' : packet.task === 'feedback_quality' ? 'Feedback output' : 'Human feedback'
  return <section className="source-panel output-panel" aria-label={title}>
    <div className="panel-title"><h2>{title}</h2></div>
    <div className="source-scroll" tabIndex={0} aria-label={title + ' text'}>
      {packet.task === 'assessment_quality' ? <div className="assessment-output">{packet.output?.dimensions?.map(dimension => <article className="assessment-dimension" key={dimension.dimension_id}>
        <header><strong>{dimension.dimension_id}</strong><span>Score {dimension.score.toFixed(1)}</span></header>
        <p>{dimension.justification}</p><EvidenceReferences ids={dimension.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} />
      </article>)}</div> : packet.task === 'feedback_quality' ? <div className="feedback-output">{(['strengths', 'weaknesses', 'suggestions'] as const).map(component => <section className="feedback-component" key={component}>
        <h3>{componentLabels[component]}</h3>
        {(packet.output?.[component] ?? []).length ? packet.output?.[component]?.map((item, index) => <div className="feedback-item" key={`${component}-${index}`}>
          <SourceText text={item.text} label={`${componentLabels[component]} ${index + 1}`} onSelect={event => onSelection(event, component, index)} />
          <EvidenceReferences ids={item.evidence_segment_ids ?? []} segments={packet.reflection.segments} {...evidence} />
        </div>) : <p className="empty-component">No items in this section.</p>}
      </section>)}</div> : <SourceText text={packet.human_feedback ?? ''} label="Human feedback" onSelect={event => onSelection(event, 'human_feedback', 0)} />}
    </div>
  </section>
}

export default function SourceComparison({ packet, onSelection }: { packet: Packet; onSelection: FeedbackSelectionHandler }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  function activateEvidence(id: string) {
    setSelectedId(id)
    const container = scrollRef.current
    const segment = container && Array.from(container.children).find(element => element.getAttribute('data-segment-id') === id)
    if (!container || !segment) return
    const containerBounds = container.getBoundingClientRect()
    const segmentBounds = segment.getBoundingClientRect()
    container.scrollTop += segmentBounds.top - containerBounds.top - Math.max(0, (containerBounds.height - segmentBounds.height) / 2)
  }
  return <div className="comparison-area">
    <ReflectionViewer segments={packet.reflection.segments} activeId={previewId ?? selectedId} scrollRef={scrollRef} />
    <OutputViewer packet={packet} onSelection={onSelection} evidence={{ selectedId, onPreview: setPreviewId, onActivate: activateEvidence }} />
  </div>
}