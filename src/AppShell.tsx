import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import './AppShell.css'

function ProjectLogo({ className = '' }: { className?: string }) {
  return <img className={`project-logo ${className}`} src={`${import.meta.env.BASE_URL}PReBi_Logo.png`} alt="PReBi" width={1758} height={864} />
}

export function AppShell({ workflow, context, children }: {
  workflow: string
  context?: ReactNode
  children: ReactNode
}) {
  const lecturer = workflow === 'Lecturer generation' || workflow === 'Lecturer API'
  const lecturerApi = workflow === 'Lecturer API'
  const g1 = workflow === 'G1 generation'
  return <div className="rating-shell">
    <header className="app-header">
      <div className="app-identity">
        <img className="institution-logo" src={`${import.meta.env.BASE_URL}ph-ludwigsburg-logo.png`} alt="Pädagogische Hochschule Ludwigsburg" />
        <div className="app-name"><ProjectLogo /></div>
      </div>
      <div className="app-context"><strong>{g1 ? 'G1 Feedback erstellen' : lecturer ? lecturerApi ? 'Lokale API-Integration' : 'Dozierenden-Demo' : workflow === 'Pairwise evaluation' ? 'PReBi Expertenevaluation' : workflow === 'Expert evaluation' ? 'Expertenbewertung' : 'Feedbackprüfung'}</strong>{context}<nav className="workflow-navigation" aria-label="Arbeitsbereich">{lecturer ? <a href={lecturerApi ? '?workflow=lecturer&source=api' : '?workflow=lecturer'} aria-current="page">Feedback erstellen ({lecturerApi ? 'API-Test' : 'Demo'})</a> : <><a href="?workflow=pairwise" aria-current={workflow === 'Pairwise evaluation' ? 'page' : undefined}>Expertenevaluation</a><a href="?workflow=review" aria-current={workflow === 'Lecturer review' ? 'page' : undefined}>Feedbackprüfung</a><a href="?workflow=g1" aria-current={g1 ? 'page' : undefined}>G1 Feedback erstellen</a></>}</nav></div>
    </header>
    {children}
  </div>
}

export function PacketFileButton({ onImport, primary = false }: {
  onImport: (event: ChangeEvent<HTMLInputElement>) => void
  primary?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <>
    <input ref={inputRef} className="packet-file-input" type="file" accept="application/json,.json" onChange={onImport} tabIndex={-1} aria-label="Bewertungspaket als JSON-Datei" />
    <button className={primary ? 'submit-button open-packet-button' : 'icon-button'} onClick={() => inputRef.current?.click()} title="Bewertungspaket als JSON-Datei öffnen">
      <Upload size={18} /><span>{primary ? 'Bewertungspaket öffnen' : 'Anderes Paket öffnen'}</span>
    </button>
  </>
}

export function EvaluationStart({ evaluatorId, onEvaluatorChange, onImport, savedCount, onExportSaved, onClear }: {
  evaluatorId: string
  onEvaluatorChange: (value: string) => void
  onImport: (event: ChangeEvent<HTMLInputElement>) => void
  savedCount: number
  onExportSaved: () => void
  onClear: () => void
}) {
  return <main className="evaluation-start">
    <section className="start-content" aria-labelledby="start-title">
      <h1 id="start-title">Expertenbewertung</h1>
      <p className="start-description">Bewerten Sie automatisch generierte Einschätzungen und Feedback zu studentischen Reflexionen. Informationen zum erzeugenden System sind ausgeblendet.</p>
      <label className="annotator-field start-annotator">Bewertungscode<input value={evaluatorId} onChange={(event) => onEvaluatorChange(event.target.value)} placeholder="Ihr zugewiesener Code" autoComplete="off" /></label>
      <PacketFileButton onImport={onImport} primary />
      <p className="local-storage-note">Bewertungen und Entwürfe werden lokal in diesem Browser gespeichert.</p>
      <details className="start-storage-actions">
        <summary>Gespeicherte Bewertungen</summary>
        <p>{savedCount} abgeschlossene Bewertungen für diesen Code.</p>
        <div className="rating-actions">
          <button className="icon-button" onClick={onExportSaved} disabled={!savedCount}><Download size={16} />Bewertungen exportieren</button>
          <button className="icon-button danger" onClick={onClear}><Trash2 size={16} />Lokale Daten löschen</button>
        </div>
      </details>
    </section>
  </main>
}