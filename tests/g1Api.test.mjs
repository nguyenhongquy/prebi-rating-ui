import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { splitReflectionSegments, makeG1Document, validateG1Output, generateG1 } = require(join(dirname(process.env.PREBI_LECTURER_SESSION_MODULE), 'g1Api.js'))
const document = makeG1Document(['Erster Absatz.', 'Zweiter Absatz.'], 'doc-1')
function output() {
  const claim = { interpretation: 'Belegte Beobachtung.', evidence_refs: ['s1'] }
  return {
    evidence_synthesis: ['SW', 'UA', 'HA'].map(dimension_id => ({
      dimension_id, demonstrated_depth: [claim], development: [claim], integrative_coherence: [claim], limitations: [], uncertainty: [],
    })),
    assessment: { component_assessments: ['SW', 'UA', 'HA'].map(dimension_id => ({
      dimension_id, band: 1.5, justification: 'Begründung.', evidence_segment_ids: ['s1'], intermediate_score_explanation: 'Zwischenwert.',
    })) },
    feedback: { strengths: [{ message: 'Stärke.', evidence_segment_ids: ['s1'] }], weaknesses: [], suggestions: [{ message: 'Vorschlag.', evidence_segment_ids: ['s2'] }] },
  }
}
const json = (raw, status = 200) => new Response(raw, { status, headers: { 'Content-Type': 'application/json' } })

test('period followed by a line break splits segments without losing text', () => {
  assert.deepEqual(splitReflectionSegments('  Eins.\r\n Zwei. \n\n Drei  '), ['Eins.', 'Zwei.', 'Drei'])
  assert.deepEqual(splitReflectionSegments('Eins. Zwei\nDrei\n\nVier?'), ['Eins. Zwei\nDrei\n\nVier?'])
  assert.deepEqual(splitReflectionSegments(' \n \n '), [])
  assert.deepEqual(splitReflectionSegments('Ende.\n'), ['Ende.'])
  assert.deepEqual(splitReflectionSegments('Erste.\rZweite.'), ['Erste.', 'Zweite.'])
})

test('common abbreviations and decimal numbers do not cause false boundaries', () => {
  assert.deepEqual(splitReflectionSegments('Zum Beispiel z. B.\nGruppenarbeit.\nDanach.'), ['Zum Beispiel z. B.\nGruppenarbeit.', 'Danach.'])
  assert.deepEqual(splitReflectionSegments('Das heißt d.\nh.\nanders.\nDanach.'), ['Das heißt d.\nh.\nanders.', 'Danach.'])
  assert.deepEqual(splitReflectionSegments('Dr.\nMüller beschreibt 3.\n14 Punkte.\nWeiter.'), ['Dr.\nMüller beschreibt 3.\n14 Punkte.', 'Weiter.'])
  assert.deepEqual(splitReflectionSegments('Wert 3.14.\nWeiter.'), ['Wert 3.14.', 'Weiter.'])
  assert.deepEqual(splitReflectionSegments('Ende.\n3 neue Aufgaben.'), ['Ende.', '3 neue Aufgaben.'])
})

test('segments produce ordered IDs', () => {
  assert.deepEqual(document, { document_id: 'doc-1', segments: [{ segment_id: 's1', text: 'Erster Absatz.', order: 0 }, { segment_id: 's2', text: 'Zweiter Absatz.', order: 1 }] })
  assert.throws(() => makeG1Document([], 'doc-1'))
  assert.throws(() => makeG1Document(['  '], 'doc-1'))
})

test('G1 request uses the standalone endpoint and retains original response', async () => {
  const raw = JSON.stringify(output(), null, 2) + '\n'
  let calls = 0
  const result = await generateG1(document, undefined, async (url, init) => {
    calls++
    assert.equal(url, '/api/g1/generate')
    assert.equal(init.method, 'POST')
    assert.deepEqual(JSON.parse(init.body), document)
    assert.equal(init.headers['Content-Type'], 'application/json')
    return json(raw)
  })
  assert.equal(calls, 1)
  assert.equal(result.raw, raw)
  assert.deepEqual(result.output, output())
  assert.deepEqual(result.document, document)
})

test('validates every dimension, score, synthesis group and evidence reference', () => {
  assert.deepEqual(validateG1Output(output(), document), output())
  const badDimension = output()
  badDimension.evidence_synthesis[0].dimension_id = 'UA'
  assert.throws(() => validateG1Output(badDimension, document))
  const badScore = output()
  badScore.assessment.component_assessments[0].band = 1.1
  assert.throws(() => validateG1Output(badScore, document))
  const missingExplanation = output()
  missingExplanation.assessment.component_assessments[0].intermediate_score_explanation = null
  assert.throws(() => validateG1Output(missingExplanation, document))
  for (const mutate of [
    value => { value.evidence_synthesis[0].uncertainty = [{ interpretation: 'x', evidence_refs: ['unknown'] }] },
    value => { value.assessment.component_assessments[0].evidence_segment_ids = ['unknown'] },
    value => { value.feedback.suggestions[0].evidence_segment_ids = ['unknown'] },
    value => { delete value.evidence_synthesis[0].development },
    value => { value.feedback.extra = [] },
  ]) {
    const invalid = output()
    mutate(invalid)
    assert.throws(() => validateG1Output(invalid, document))
  }
})

test('errors are explicit, safe, and never retry automatically', async () => {
  for (const status of [422, 502, 503, 500]) {
    let calls = 0
    await assert.rejects(generateG1(document, undefined, async () => { calls++; return json('{"detail":"SECRET"}', status) }), error => !error.message.includes('SECRET'))
    assert.equal(calls, 1)
  }
  await assert.rejects(generateG1(document, undefined, async () => { throw new Error('PRIVATE') }), /Ergebnis ist unbekannt/)
  await assert.rejects(generateG1(document, undefined, async () => json('{')), /ungültiges JSON/)
  await assert.rejects(generateG1(document, undefined, async () => new Response('bad', { headers: { 'Content-Type': 'text/html' } })), /keine JSON-Antwort/)
  await assert.rejects(generateG1(document, undefined, async () => json(' '.repeat(5_000_001))), /5 MB/)
})
