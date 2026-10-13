import type { C1Snapshot, FeedbackComparisonCase, Packet } from './ratingTypes'
import './FeedbackComparisonControls.css'

export default function FeedbackComparisonControls({ packet, snapshot, comparison, onDecision, onScoreChange, onReasonChange, onFinalize, onReopen }: {
  packet: Packet
  snapshot: C1Snapshot
  comparison: FeedbackComparisonCase
  onDecision: (decision: 'keep' | 'revised') => void
  onScoreChange: (criterionId: string, score: number | null) => void
  onReasonChange: (criterionId: string, reason: string) => void
  onFinalize: () => void
  onReopen: () => void
}) {
  if (packet.task !== 'feedback_quality') return null
  const finalized = comparison.status === 'finalized'
  return <section className="feedback-comparison-controls" aria-label="Historischer Feedbackvergleich">
    <header className="panel-title"><h2>Ursprüngliche Bewertung (C1)</h2>{finalized && <span>{comparison.decision === 'keep' ? 'Bewertung beibehalten' : 'Bewertung revidiert'}</span>}</header>
    <p className="comparison-provenance">C1-Snapshot · {snapshot.snapshot_id} · {new Date(snapshot.finalized_at).toLocaleString('de-DE')}</p>
    <div className="c1-rating-list">{(packet.criteria ?? []).map(criterion => {
      const original = snapshot.criterion_ratings[criterion.criterion_id]
      const revisedScore = comparison.revised_criterion_ratings[criterion.criterion_id]
      const changed = revisedScore !== original.score
      return <article className="c1-rating-row" key={criterion.criterion_id}>
        <strong>{criterion.label}</strong>
        <div><span>C1 · Ursprüngliche Bewertung</span><b>{original.unable_to_judge ? 'Nicht beurteilbar' : `${original.score} / ${packet.scale?.max ?? 5}`}</b></div>
        {comparison.decision === 'revised' && changed && <div className="c2-revised-score"><span>C2 · Revidierte Bewertung</span><b>{revisedScore === null ? 'Nicht beurteilbar' : `${revisedScore} / ${packet.scale?.max ?? 5}`}</b><p>{comparison.revision_reasons[criterion.criterion_id]}</p></div>}
        {original.comment && <p className="c1-criterion-comment">{original.comment}</p>}
        {!finalized && comparison.decision === 'revised' && <>
          <label className="field"><span>{criterion.label} · C2-Bewertung</span><select
            value={revisedScore === null ? '' : revisedScore}
            onChange={event => onScoreChange(criterion.criterion_id, event.target.value === '' ? null : Number(event.target.value))}
          ><option value="">Nicht beurteilbar</option>{Array.from({ length: (packet.scale?.max ?? 5) - (packet.scale?.min ?? 1) + 1 }, (_, index) => (packet.scale?.min ?? 1) + index).map(score => <option key={score} value={score}>{score} / {packet.scale?.max ?? 5}</option>)}</select></label>
          {revisedScore !== original.score && <label className="field"><span>Änderung begründen <small>Erforderlich</small></span><textarea rows={2} minLength={5} value={comparison.revision_reasons[criterion.criterion_id] ?? ''} onChange={event => onReasonChange(criterion.criterion_id, event.target.value)} /></label>}
        </>}
      </article>
    })}</div>
    {snapshot.overall_comment && <section className="c1-overall"><strong>C1 · Gesamtkommentar</strong><p>{snapshot.overall_comment}</p></section>}
    {snapshot.consensus_note && <section className="c1-overall"><strong>C1 · Konsensnotiz</strong><p>{snapshot.consensus_note}</p></section>}
    {finalized ? <div className="c2-finalized"><p role="status">Vergleich abgeschlossen{comparison.finalized_at ? ` · ${new Date(comparison.finalized_at).toLocaleString('de-DE')}` : ''}</p><button className="icon-button" onClick={onReopen}>Vergleich erneut öffnen</button></div> : <div className="c2-actions">
      {!comparison.decision && <><button className="icon-button" onClick={() => onDecision('keep')}>Bewertung beibehalten</button><button className="submit-button" onClick={() => onDecision('revised')}>Bewertung revidieren</button></>}
      {comparison.decision === 'revised' && <><button className="icon-button" onClick={() => onDecision('keep')}>Bewertung beibehalten</button><button className="submit-button" onClick={onFinalize}>Vergleich abschließen</button></>}
    </div>}
  </section>
}
