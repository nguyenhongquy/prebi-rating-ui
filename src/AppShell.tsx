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
  return <div className="rating-shell">
    <header className="app-header">
      <div className="app-identity">
        <img className="institution-logo" src={`${import.meta.env.BASE_URL}ph-ludwigsburg-logo.png`} alt="Pädagogische Hochschule Ludwigsburg · University of Education" />
        <div className="app-name"><ProjectLogo /><p>Feedback for reflective writing</p></div>
      </div>
      <div className="app-context"><strong>{workflow}</strong>{context}<nav className="workflow-navigation" aria-label="Workflow"><a href="?workflow=evaluation" aria-current={workflow === 'Expert evaluation' ? 'page' : undefined}>Expert evaluation</a><a href="?workflow=review" aria-current={workflow === 'Lecturer review' ? 'page' : undefined}>Lecturer review</a></nav></div>
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
    <input ref={inputRef} className="packet-file-input" type="file" accept="application/json,.json" onChange={onImport} tabIndex={-1} aria-label="Evaluation packet file" />
    <button className={primary ? 'submit-button open-packet-button' : 'icon-button'} onClick={() => inputRef.current?.click()} title="Open evaluation packet JSON">
      <Upload size={18} /><span>{primary ? 'Open evaluation packet' : 'Open another packet'}</span>
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
      <ProjectLogo className="start-project-logo" />
      <h1 id="start-title">Expert evaluation</h1>
      <p className="start-description">Evaluate automatically generated assessment and feedback for student reflections. Generator information is blinded.</p>
      <label className="annotator-field start-annotator">Annotator code<input value={evaluatorId} onChange={(event) => onEvaluatorChange(event.target.value)} placeholder="Your assigned code" autoComplete="off" /></label>
      <PacketFileButton onImport={onImport} primary />
      <p className="local-storage-note">Ratings and drafts are stored locally in this browser.</p>
      <details className="start-storage-actions">
        <summary>Stored responses</summary>
        <p>{savedCount} submitted ratings for this annotator.</p>
        <div className="rating-actions">
          <button className="icon-button" onClick={onExportSaved} disabled={!savedCount}><Download size={16} />Export stored ratings</button>
          <button className="icon-button danger" onClick={onClear}><Trash2 size={16} />Clear local data</button>
        </div>
      </details>
    </section>
  </main>
}