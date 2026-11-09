import type { Candidate, Condition, PreparedCase } from './lecturerSession'

export interface LecturerService {
  prepare(): Promise<unknown>
  generate(prepared: PreparedCase, condition: Condition, attemptId: string): Promise<unknown>
}

export const SYNTHETIC_CASE: PreparedCase = {
  documentId: 'synthetic-reflection-v1',
  provenance: 'synthetic-fake-v1',
  rubric: {
    id: 'illustrative-rubric', version: 'demo-1',
    guidance: 'Illustrative Demo, kein freigegebenes Bewertungsprotokoll. SW: Situation wahrnehmen; UA: Ursachen analysieren; HA: Handlungsalternativen entwickeln. 0 = nicht erkennbar, 1 = ansatzweise, 2 = nachvollziehbar, 3 = differenziert; halbe Schritte möglich.',
  },
  segments: [
    { segment_id: 's1', order: 0, text: 'In einer erfundenen Unterrichtsstunde arbeiteten einige Lernende nicht an der Gruppenaufgabe. Ich wiederholte den Arbeitsauftrag.', prediction: { SW: 2, UA: 0, HA: 0 } },
    { segment_id: 's2', order: 1, text: 'Möglicherweise waren die Rollen unklar. Ich hatte nicht überprüft, ob alle den Auftrag verstanden hatten.', prediction: { SW: 1, UA: 2, HA: 0 } },
    { segment_id: 's3', order: 2, text: 'Beim nächsten Mal möchte ich die Rollen verteilen und eine Gruppe den Auftrag in eigenen Worten wiedergeben lassen.', prediction: { SW: 0, UA: 1, HA: 2 } },
  ],
}

export function createFakeLecturerService(options: { delayMs?: number; failOnce?: Condition[] } = {}): LecturerService {
  const failures = new Set(options.failOnce ?? [])
  const wait = () => new Promise(resolve => setTimeout(resolve, options.delayMs ?? 250))
  return {
    async prepare() { await wait(); return structuredClone(SYNTHETIC_CASE) },
    async generate(prepared, condition, attemptId): Promise<Candidate> {
      await wait()
      if (failures.delete(condition)) throw new Error(`Simulierter ${condition}-Fehler. Der andere Kandidat bleibt erhalten; versuchen Sie diesen Kandidaten erneut.`)
      const texts = condition === 'G1'
        ? ['Sie beschreiben eine konkrete Unterrichtssituation.', 'Die Ursachen könnten genauer gegeneinander abgewogen werden.', 'Planen Sie eine kurze Verständniskontrolle.']
        : ['Sie verbinden die Beobachtung mit einer möglichen Ursache.', 'Weitere Erklärungen für die geringe Beteiligung fehlen.', 'Prüfen Sie nach der Rollenverteilung, ob alle aktiv mitarbeiten.']
      return {
        id: `candidate-${attemptId}`, condition, documentId: prepared.documentId,
        rubricId: prepared.rubric.id, rubricVersion: prepared.rubric.version, provenance: 'synthetic-fake-v1',
        items: texts.map((text, index) => ({ id: `${condition}-item-${index}`, category: (['strengths', 'weaknesses', 'suggestions'] as const)[index], text, evidence: [prepared.segments[index].segment_id], source: null })),
      }
    },
  }
}
