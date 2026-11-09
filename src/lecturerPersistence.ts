import { readSession, writeSession, deleteSession } from './localSessions'
import { canonicalJson } from './ratingValidation'
import { parseLecturerSession, type LecturerSession } from './lecturerSession'

export const LECTURER_STORAGE_KEY = 'lecturer-workflow::synthetic::v1'

export class LecturerPersistence {
  private expected: string | undefined
  private queue: Promise<void> = Promise.resolve()

  async load(): Promise<LecturerSession | null> {
    const raw = await readSession<unknown>(LECTURER_STORAGE_KEY)
    this.expected = raw === undefined ? undefined : canonicalJson(raw)
    return raw === undefined ? null : parseLecturerSession(raw)
  }

  save(session: LecturerSession | null): Promise<void> {
    const snapshot = session === null ? null : parseLecturerSession(session, false)
    this.queue = this.queue.then(async () => {
      if (!navigator.locks) throw new Error('Dieser Browser unterstützt keine sichere tabübergreifende Speicherung. Exportieren Sie eine Sicherung.')
      await navigator.locks.request(`prebi:${LECTURER_STORAGE_KEY}`, async () => {
        const previous = await readSession<unknown>(LECTURER_STORAGE_KEY)
        if ((previous === undefined ? undefined : canonicalJson(previous)) !== this.expected) {
          throw new Error('Ein anderes Fenster hat diesen Stand geändert. Exportieren Sie Ihre Änderungen und laden Sie die Seite neu; es wird nichts überschrieben.')
        }
        if (snapshot === null) await deleteSession(LECTURER_STORAGE_KEY)
        else await writeSession(LECTURER_STORAGE_KEY, snapshot)
        this.expected = snapshot === null ? undefined : canonicalJson(snapshot)
      })
    })
    return this.queue
  }
}
