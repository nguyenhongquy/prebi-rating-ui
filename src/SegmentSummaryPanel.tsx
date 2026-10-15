import type { SegmentAnnotationSummaryDimension } from './ratingTypes'

const formatPercent = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function SegmentSummaryPanel({ dimensions, title = 'Referenz aus dem Modellierungssplit', variant = 'modelling' }: {
  dimensions: Array<Pick<SegmentAnnotationSummaryDimension, 'dimension_id' | 'positive_band_count' | 'band_counts' | 'band_percentages' | 'distinct_assigned_segment_count'>>
  title?: string
  variant?: 'modelling' | 'pairwise'
}) {
  const pairwise = variant === 'pairwise'
  return <section className="modelling-band-summary" aria-label={title}>
    <h3>{title}</h3>
    <div className="modelling-band-summary-scroll">
      <table>
        <thead><tr><th>Dimension</th><th>{pairwise ? 'Segmente mit Band A–C' : 'Zugeordnete Kandidaten'}</th><th>Band A</th><th>Band B</th><th>Band C</th>{!pairwise && <th>Verschiedene zugeordnete Segmente</th>}</tr></thead>
        <tbody>{dimensions.map(dimension => <tr key={dimension.dimension_id}>
          <th scope="row">{dimension.dimension_id}</th>
          <td>{dimension.positive_band_count}</td>
          {(['1', '2', '3'] as const).map(band => <td key={band}>{dimension.band_counts[band]} <small>({formatPercent(dimension.band_percentages[band])}%)</small></td>)}
          {!pairwise && <td>{dimension.distinct_assigned_segment_count ?? '–'}</td>}
        </tr>)}</tbody>
      </table>
    </div>
    <p>{pairwise
      ? 'Prozentwerte beziehen sich auf die Segmente mit Band A–C in dieser Dimension. A/B/C sind ordinale Evidenzkategorien, keine Dokumentnoten; A kann fehlende oder unzureichende Leistung enthalten.'
      : 'Prozentwerte beziehen sich auf bekannte, dieser Dimension zugeordnete Kandidatenannotationen. Mehrere Kandidaten desselben Segments sind keine unabhängigen Belege. A/B/C sind ordinale Evidenzkategorien, keine Dokumentnoten; A kann fehlende oder unzureichende Leistung enthalten.'}</p>
  </section>
}
