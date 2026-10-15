import { Lock } from 'lucide-react'
import { referenceAnchorScores } from './ratingValidation'
import type { CaseResponse, ReferenceScoring } from './pairwiseEvaluationTypes'
import { referenceScoresComplete } from './pairwiseEvaluationValidation'

const formatScore = (score: number) => score.toFixed(1).replace('.', ',')

export default function PairwiseReferenceScoring({ reference, response, caseId, onScore, onComment, onConfirm }: {
  reference: ReferenceScoring
  response: CaseResponse
  caseId: string
  onScore: (dimensionId: string, score: number) => void
  onComment: (dimensionId: string, comment: string) => void
  onConfirm: () => void
}) {
  const locked = Boolean(response.reference_confirmed_at)
  const scoreOptions = Array.from({ length: Math.round((reference.scale.max - reference.scale.min) / reference.scale.step) + 1 }, (_, index) => reference.scale.min + index * reference.scale.step)
  const ready = referenceScoresComplete(response, reference.dimensions.map(dimension => dimension.dimension_id))
  return <section className="pairwise-task-content pairwise-reference" aria-labelledby="reference-title">
    <h2 id="reference-title">Referenzbewertung der Reflexion</h2>
    <p>Bewerten Sie die Reflexionsleistung in jeder Dimension, bevor Sie die Rückmeldungen sehen. Die Stufen 0 bis 3 dienen als Anker; Zwischenwerte in Schritten von 0,5 sind möglich.</p>
    <details className="pairwise-reference-guide"><summary>Bewertungsleitfaden (Protokoll {reference.protocol_version})</summary><pre>{reference.human_protocol}</pre></details>
    {locked && <p className="pairwise-reference-locked" role="status"><Lock size={15} />Referenzbewertung abgeschlossen. Die Werte sind gesperrt und können nicht mehr geändert werden.</p>}
    {reference.dimensions.map(dimension => {
      const score = response.reference_scores[dimension.dimension_id]
      const selected = new Set(referenceAnchorScores(score ?? null, Object.keys(dimension.bands).map(Number)))
      return <article key={dimension.dimension_id} className={`pairwise-reference-dimension annotation-${dimension.dimension_id.toLowerCase()}`}>
        <header><h3>{dimension.name}</h3><output>{score === undefined ? 'Noch offen' : `${formatScore(score)} / ${formatScore(reference.scale.max)}`}</output></header>
        <p>{dimension.description}</p>
        <dl className="pairwise-reference-anchors">{Object.entries(dimension.bands).sort(([left], [right]) => Number(left) - Number(right)).map(([band, text]) => <div key={band} className={selected.has(Number(band)) ? 'surrounding' : ''}><dt>{band}</dt><dd>{text}</dd></div>)}</dl>
        <fieldset className="pairwise-reference-scale" disabled={locked}>
          <legend>Bewertung {dimension.name}</legend>
          {scoreOptions.map(option => <label key={option} className={score === option ? 'selected' : ''}>
            <input type="radio" name={`reference-${caseId}-${dimension.dimension_id}`} value={option} checked={score === option} onChange={() => onScore(dimension.dimension_id, option)} />
            <span>{formatScore(option)}</span>
          </label>)}
        </fieldset>
        <label className="pairwise-explanation">Kommentar <span>(optional)</span><textarea rows={2} value={response.reference_comments[dimension.dimension_id] ?? ''} disabled={locked} aria-label={`${dimension.name} · Kommentar (optional)`} onChange={event => onComment(dimension.dimension_id, event.target.value)} /></label>
      </article>
    })}
    {!locked && <div className="pairwise-reference-confirm">
      <p>{ready ? 'Nach dem Abschluss werden die Werte gesperrt und die drei Rückmeldungen angezeigt.' : 'Bitte vergeben Sie für alle drei Dimensionen einen Wert.'}</p>
      <button className="submit-button" disabled={!ready} onClick={() => {
        if (window.confirm('Referenzbewertung abschließen? Die Werte können danach nicht mehr geändert werden.')) onConfirm()
      }}><Lock size={16} />Referenzbewertung abschließen und Feedback anzeigen</button>
    </div>}
  </section>
}
