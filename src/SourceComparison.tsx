import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { ArrowUpRight, Lightbulb, Link, Sprout } from 'lucide-react'
import { componentLabels, type Packet, type Segment } from './ratingTypes'
import { segmentDisplayNumbers, visibleModellingBands } from './ratingValidation'
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
  const segmentNumbers = segmentDisplayNumbers(segments)
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

export function ComparisonWorkspace({ reflection, children, reflectionOnly = false }: { reflection: ReactNode; children: ReactNode; reflectionOnly?: boolean }) {
  return <div className={`comparison-area${reflectionOnly ? ' reflection-only' : ''}`}>{reflection}<div className="workspace-review">{children}</div></div>
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

export function ReflectionViewer({ segments, annotations = [], dimensionLabels = {}, activeId, activeIds = [], scrollRef, evidenceSelection }: { segments: Segment[]; annotations?: NonNullable<Packet['segment_annotations']>; dimensionLabels?: Record<string, string>; activeId: string | null; activeIds?: string[]; scrollRef: RefObject<HTMLDivElement | null>; evidenceSelection?: { ids: string[]; onToggle: (id: string) => void; label: string } }) {
  const dimensions = new Map(Object.entries(dimensionLabels))
  const segmentNumbers = segmentDisplayNumbers(segments)
  const hasCandidateReferences = annotations.some(annotation => annotation.candidate_id !== undefined)
  return <section className="source-panel" aria-label="Reflexion">
    <div className="panel-title"><h2>Reflexion</h2><small>{segments.length} {segments.length === 1 ? 'Segment' : 'Segmente'}</small></div>
    {hasCandidateReferences && <p className="annotation-source-note">Die Karten zeigen vorhandene Segmentannotationen aus dem Modellierungssplit als Kontext. Sie sind kein fertiger Task-A-Punktwert: Bewerten Sie die Reflexion weiterhin selbst anhand der Rubrik. Mehrere Modellierungskandidaten bleiben getrennt und sind nicht adjudiziert; „Unbekannt“ bedeutet, dass für dieses Merkmal keine bekannte Annotation vorliegt.</p>}
    <div ref={scrollRef} className="source-scroll segments" tabIndex={0} aria-label="Reflexionssegmente">
      {segments.map(segment => {
        const segmentAnnotations = annotations.filter(annotation => annotation.segment_id === segment.segment_id)
        const candidateGroups = new Map<string, NonNullable<Packet['segment_annotations']>>()
        for (const annotation of segmentAnnotations) {
          if (!annotation.candidate_id) continue
          const group = candidateGroups.get(annotation.candidate_id) ?? []
          group.push(annotation)
          candidateGroups.set(annotation.candidate_id, group)
        }
        const legacyAnnotations = segmentAnnotations.filter(annotation => !annotation.candidate_id)
        return <article className={`segment${activeId === segment.segment_id || activeIds.includes(segment.segment_id) || evidenceSelection?.ids.includes(segment.segment_id) ? ' evidence-highlight' : ''}`} key={segment.segment_id} data-segment-id={segment.segment_id} aria-label={`Reflexionssegment ${segmentNumbers.get(segment.segment_id)}${activeId === segment.segment_id || activeIds.includes(segment.segment_id) ? ', hervorgehobener Beleg' : ''}`}>
          {evidenceSelection ? <label className="segment-evidence-choice"><input type="checkbox" aria-label={`Segment ${segmentNumbers.get(segment.segment_id)} als Beleg für ${evidenceSelection.label}`} checked={evidenceSelection.ids.includes(segment.segment_id)} onChange={() => evidenceSelection.onToggle(segment.segment_id)} /><span>{segmentNumbers.get(segment.segment_id)}</span></label> : <span className="segment-id">{segmentNumbers.get(segment.segment_id)}</span>}<div><p>{segment.text}</p>
            {candidateGroups.size > 0 && <div className="segment-candidate-references" aria-label={`Modellierungssplit-Referenzen zu Segment ${segmentNumbers.get(segment.segment_id)}`}>
              {[...candidateGroups.values()].map(candidate => {
                const nonZeroBands = visibleModellingBands(candidate, Object.fromEntries(dimensions))
                if (!nonZeroBands.length) return null
                const candidateId = candidate[0].candidate_id
                return <div className="candidate-reference" key={candidateId}>
                  <div className="candidate-reference-bands">{nonZeroBands.map(item => <span className={`candidate-reference-band candidate-band-${item.dimension_id.toLowerCase()}`} key={item.dimension_id}><strong>{item.label}</strong><b>{item.band}</b></span>)}</div>
                </div>
              })}
            </div>}
            {legacyAnnotations.length > 0 && <ul className="segment-annotations" aria-label={`Expertenannotationen zu Segment ${segmentNumbers.get(segment.segment_id)}`}>{legacyAnnotations.map((annotation, index) => <li className={`annotation-${annotation.dimension_id.toLowerCase()}`} key={`${annotation.dimension_id}-${index}`}><strong>{dimensions.get(annotation.dimension_id) ?? annotation.dimension_id}</strong>{annotation.level && <small>{annotation.level}</small>}</li>)}</ul>}
          </div>
        </article>
      })}
    </div>
  </section>
}

export function OutputViewer({ packet, onSelection, evidence, selectedItem, onShowItem, assessmentReference, historicalFeedback }: { packet: Packet; onSelection: FeedbackSelectionHandler; evidence: EvidenceInteraction; selectedItem?: string | null; onShowItem?: (key: string, ids: string[]) => void; assessmentReference?: { state: string; scores: Record<string, number> | null; onConfirm?: () => void }; historicalFeedback?: string }) {
  const title = packet.task === 'assessment_quality' ? 'Generierte Einschätzung' : packet.task === 'feedback_quality' ? 'Generiertes Feedback' : 'Menschliches Feedback'
  return <section className={`source-panel output-panel${historicalFeedback !== undefined ? ' historical-comparison-mode' : ''}`} aria-label={title}>
    <div className="panel-title"><h2>{title}</h2></div>
    {packet.task === 'assessment_quality' && <section className={`assessment-reference assessment-reference-${assessmentReference?.state ?? 'unavailable'}`} aria-label="Expertenreferenz">
      <strong>Expertenreferenz</strong>
      {!assessmentReference?.scores && <p>Referenzbewertung noch nicht abgeschlossen.</p>}
      {assessmentReference?.state === 'changed' && <p role="status">Die Referenzbewertung wurde seit der Task-B-Finalisierung geändert oder ist vorübergehend nicht verfügbar.</p>}
      {assessmentReference?.state === 'available' && assessmentReference.onConfirm && <p role="status">Diese Referenz wurde nach der Task-B-Finalisierung verfügbar. Prüfen Sie sie ausdrücklich.</p>}
      {(assessmentReference?.state === 'changed' || assessmentReference?.state === 'available') && assessmentReference.onConfirm && <button className="icon-button" onClick={assessmentReference.onConfirm}>Aktuelle Referenz prüfen</button>}
      {assessmentReference?.state === 'reviewed' && <p role="status">Aktuelle Referenz wurde ausdrücklich geprüft.</p>}
    </section>}
    <div className="source-scroll" tabIndex={0} aria-label={title + ' · Text'}>
      {packet.task === 'assessment_quality' ? <div className="assessment-output">{packet.output?.dimensions?.map(dimension => <article className={`assessment-dimension${selectedItem === dimension.dimension_id ? ' selected-feedback' : ''}`} key={dimension.dimension_id}>
        <header><strong>{dimension.dimension_id} · {packet.rubric.dimensions.find(item => item.dimension_id === dimension.dimension_id)?.name ?? dimension.dimension_id}</strong></header>
        <div className="assessment-score-pair"><div><span>Expertenreferenz</span><strong>{assessmentReference?.scores?.[dimension.dimension_id]?.toLocaleString('de-DE', { maximumFractionDigits: 1 }) ?? '—'}</strong></div><div><span>Generierte Einschätzung</span><strong>{dimension.score.toLocaleString('de-DE', { maximumFractionDigits: 20 })}</strong></div></div>
        <p>{dimension.justification}</p><EvidenceReferences ids={dimension.evidence_segment_ids} segments={packet.reflection.segments} {...evidence} onShow={() => onShowItem?.(dimension.dimension_id, dimension.evidence_segment_ids)} onActivate={id => { onShowItem?.(dimension.dimension_id, dimension.evidence_segment_ids); evidence.onActivate(id) }} />
      </article>)}</div> : packet.task === 'feedback_quality' ? <div className="feedback-output">{(['strengths', 'weaknesses', 'suggestions'] as const).map(component => <section className="feedback-component" key={component}>
        <FeedbackHeading component={component} />
        {(packet.output?.[component] ?? []).length ? packet.output?.[component]?.map((item, index) => <div className={`feedback-item${selectedItem === `${component}-${index}` ? ' selected-feedback' : ''}`} key={`${component}-${index}`}>
          <SourceText text={item.text} label={`${componentLabels[component]} ${index + 1}`} onSelect={event => onSelection(event, component, index)} />
          <EvidenceReferences ids={item.evidence_segment_ids ?? []} segments={packet.reflection.segments} {...evidence} onShow={() => onShowItem?.(`${component}-${index}`, item.evidence_segment_ids ?? [])} onActivate={id => { onShowItem?.(`${component}-${index}`, item.evidence_segment_ids ?? []); evidence.onActivate(id) }} />
        </div>) : <p className="empty-component">Keine Einträge in diesem Abschnitt.</p>}
      </section>)}</div> : <SourceText text={packet.human_feedback ?? ''} label="Menschliches Feedback" onSelect={event => onSelection(event, 'human_feedback', 0)} />}
    </div>
    {packet.task === 'feedback_quality' && historicalFeedback !== undefined && <section className="historical-feedback-panel" aria-label="Historisches Feedback">
      <h3>Historisches Feedback</h3><p>{historicalFeedback}</p>
    </section>}
  </section>
}

export default function SourceComparison({ packet, onSelection, children, referenceEvidence, assessmentReference, historicalFeedback }: { packet: Packet; onSelection: FeedbackSelectionHandler; children?: ReactNode; referenceEvidence?: { ids: string[]; label: string; onToggle: (id: string) => void }; assessmentReference?: { state: string; scores: Record<string, number> | null; onConfirm?: () => void }; historicalFeedback?: string }) {
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
  const reflectionOnly = packet.task === 'reflection_reference_score'
  return <ComparisonWorkspace reflectionOnly={reflectionOnly} reflection={<ReflectionViewer segments={packet.reflection.segments} annotations={reflectionOnly ? packet.segment_annotations : undefined} dimensionLabels={Object.fromEntries((packet.score_dimensions ?? []).map(dimension => [dimension.dimension_id, dimension.label]))} activeId={previewId ?? selectedId} activeIds={selectedIds} scrollRef={scrollRef} evidenceSelection={reflectionOnly ? referenceEvidence : undefined} />}>
    {!reflectionOnly && <OutputViewer packet={packet} onSelection={onSelection} selectedItem={selectedItem} onShowItem={showItem} assessmentReference={assessmentReference} historicalFeedback={historicalFeedback} evidence={{ selectedId, selectedIds, onPreview: setPreviewId, onActivate: activateEvidence }} />}
    {children}
  </ComparisonWorkspace>
}