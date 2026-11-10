import { readSession, writeSession, deleteSession } from './localSessions'
import { canonicalJson } from './ratingValidation'
import { parseLecturerSession, type LecturerSession } from './lecturerSession'

export const LECTURER_STORAGE_KEY = 'lecturer-workflow::synthetic::v1'

export class LecturerPersistence {
  constructor(private readonly mode: 'synthetic' | 'api' = 'synthetic') {}
  private get key() { return this.mode === 'api' ? 'lecturer-workflow::api::v1.1' : LECTURER_STORAGE_KEY }
  private checkMode(session: LecturerSession) {
    if (Boolean(session.prepared.api) !== (this.mode === 'api')) throw new Error('Die Sicherung gehört zu einem anderen Workflow-Modus.')
    return session
  }
  private expected: string | undefined
  private queue: Promise<void> = Promise.resolve()

  async load(): Promise<LecturerSession | null> {
    const raw = await readSession<unknown>(this.key)
    this.expected = raw === undefined ? undefined : canonicalJson(raw)
    return raw === undefined ? null : this.checkMode(parseLecturerSession(raw))
  }

  save(session: LecturerSession | null): Promise<void> {
    const snapshot = session === null ? null : this.checkMode(parseLecturerSession(session, false))
    this.queue = this.queue.then(async () => {
      if (!navigator.locks) throw new Error('Dieser Browser unterstützt keine sichere tabübergreifende Speicherung. Exportieren Sie eine Sicherung.')
      await navigator.locks.request(`prebi:${this.key}`, async () => {
        const previous = await readSession<unknown>(this.key)
        if ((previous === undefined ? undefined : canonicalJson(previous)) !== this.expected) {
          throw new Error('Ein anderes Fenster hat diesen Stand geändert. Exportieren Sie Ihre Änderungen und laden Sie die Seite neu; es wird nichts überschrieben.')
        }
        if (snapshot === null) await deleteSession(this.key)
        else await writeSession(this.key, snapshot)
        this.expected = snapshot === null ? undefined : canonicalJson(snapshot)
      })
    })
    return this.queue
  }
}
