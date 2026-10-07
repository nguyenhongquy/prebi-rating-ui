import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const directory = mkdtempSync(join(tmpdir(), 'prebi-expert-'))
let helpers
let validation
try {
  execFileSync(process.execPath, [new URL('../node_modules/typescript/bin/tsc', import.meta.url).pathname, '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--skipLibCheck', '--outDir', directory, new URL('../src/expertSession.ts', import.meta.url).pathname])
  const require = createRequire(import.meta.url)
  helpers = require(join(directory, 'expertSession.js'))
  validation = require(join(directory, 'ratingValidation.js'))
} finally {
  rmSync(directory, { recursive: true, force: true })
}
const { bundleHash, validateSession, validateDraft, validatePackets, assertSourcesMatch, draftFromResponse, checkPacketHashes, sessionKey, expertCaseState, legacyDraft } = helpers
const { emptyDraft, caseState, responseForDraft } = validation
const packets = validatePackets(JSON.parse(readFileSync(new URL('../public/examples/synthetic-evaluation-bundle.json', import.meta.url), 'utf8')).packets)
const implied = packets.find(packet => packet.task === 'feedback_implied_score')
const quality = packets.find(packet => packet.task === 'feedback_quality')
const fresh = async () => ({ kind: 'prebi_expert_session', schema_version: '1.0.0', evaluator_id: 'EXPERT', bundle_sha256: await bundleHash(packets), packets, drafts: Object.fromEntries(packets.map(packet => [packet.packet_id, emptyDraft(packet)])), active_task: packets[0].task, active_index: 0, active_criterion: 0 })

test('partial session round-trips unanswered dimensions, nulls, identity and order', async () => {
  const session = await fresh()
  session.drafts[quality.packet_id].overallComment = 'Partial comment'
  const restored = await validateSession(JSON.parse(JSON.stringify(session)))
  assert.deepEqual(restored, session)
  assert.equal(restored.drafts[implied.packet_id].scoreAnswers.SW.status, 'unanswered')
  assert.equal(restored.drafts[implied.packet_id].scoreAnswers.SW.score, null)
  assert.equal(caseState(quality, restored.drafts[quality.packet_id]), 'in_progress')
  assert.equal(sessionKey(session), `expert::EXPERT::${session.bundle_sha256}`)
})

test('bundle hash is independent of packet and object-key order, but source-sensitive', async () => {
  assert.equal(await bundleHash(packets), await bundleHash([...packets].reverse()))
  assert.notEqual(await bundleHash(packets), await bundleHash(packets.map(packet => ({ ...packet, human_protocol: 'Changed' }))))
  assert.throws(() => assertSourcesMatch([{ ...packets[0], human_protocol: 'Changed' }], packets), /anderen Quelle/)
  assert.throws(() => validatePackets([packets[0], packets[0]]), /eindeutig/)
})

test('pending editors round-trip selection, unadded text and tags without changing research drafts', async () => {
  const session = await fresh()
  const drafts = structuredClone(session.drafts)
  session.pending_editors = {
    [quality.packet_id]: { selection: { component: 'strengths', index: 0, start: 0, end: 3, quote: quality.output.strengths[0].text.slice(0, 3) }, comment: 'Unadded note', tags: ['strength', 'other'] },
    [implied.packet_id]: { selection: null, comment: 'Partial note without selection', tags: [] },
  }
  const original = structuredClone(session)
  const restored = await validateSession(JSON.parse(JSON.stringify(session)))
  assert.deepEqual(restored, session)
  assert.deepEqual(session, original)
  assert.deepEqual(restored.drafts, drafts)
  assert.equal(expertCaseState(quality, restored), 'in_progress')
  assert.equal(expertCaseState(implied, restored), 'in_progress')
  assert.equal(responseForDraft(quality, restored.drafts[quality.packet_id]).feedback_span_comments.length, 0)
})

test('selection and tags alone do not start or complete a case', async () => {
  const session = await fresh()
  session.pending_editors = { [implied.packet_id]: { selection: { component: 'human_feedback', index: 0, start: 0, end: 4, quote: implied.human_feedback.slice(0, 4) }, comment: '  ', tags: ['other'] } }
  const restored = await validateSession(session)
  assert.equal(expertCaseState(implied, restored), 'not_started')
  restored.pending_editors[implied.packet_id].comment = 'Note'
  assert.equal(expertCaseState(implied, restored), 'in_progress')
  for (const answer of Object.values(restored.drafts[implied.packet_id].scoreAnswers)) Object.assign(answer, { status: 'not_inferable', rationale: 'Intentional reason' })
  assert.equal(expertCaseState(implied, restored), 'complete')
})

test('pending editor validation rejects forged sources, bounds, shapes, tags and packet IDs', async () => {
  const editor = { selection: { component: 'strengths', index: 0, start: 0, end: 3, quote: quality.output.strengths[0].text.slice(0, 3) }, comment: '', tags: [] }
  for (const patch of [{ component: 'unknown' }, { component: ['strengths'] }, { component: 'human_feedback' }, { index: -1 }, { index: 0.5 }, { index: 999 }, { index: '0' }, { start: -1 }, { start: 0.5 }, { start: '0' }, { end: 0 }, { end: 999999 }, { quote: 'forged' }, { quote: 3 }, { extra: true }]) {
    const session = await fresh()
    session.pending_editors = { [quality.packet_id]: { ...editor, selection: { ...editor.selection, ...patch } } }
    await assert.rejects(validateSession(session))
  }
  for (const patch of [{ comment: null }, { tags: ['unknown'] }, { tags: ['other', 'other'] }, { tags: [['other']] }, { tags: null }, { selection: undefined }, { extra: true }]) {
    const session = await fresh()
    session.pending_editors = { [quality.packet_id]: { ...editor, ...patch } }
    await assert.rejects(validateSession(session))
  }
  for (const editors of [null, [], { unknown: editor }, { constructor: editor }, { [packets.find(packet => packet.task === 'assessment_quality').packet_id]: editor }]) {
    await assert.rejects(validateSession({ ...await fresh(), pending_editors: editors }))
  }
  const session = await fresh()
  session.pending_editors = { [implied.packet_id]: { ...editor, selection: { ...editor.selection, component: 'human_feedback', index: 1 } } }
  await assert.rejects(validateSession(session))
})

test('legacy empty not-inferable defaults normalize without mutation or losing rationale states', async () => {
  const session = await fresh()
  const draft = session.drafts[implied.packet_id]
  for (const answer of Object.values(draft.scoreAnswers)) answer.status = 'not_inferable'
  const original = structuredClone(session)
  const restored = await validateSession(session)
  assert.equal(expertCaseState(implied, restored), 'not_started')
  assert.equal(restored.drafts[implied.packet_id].scoreAnswers.SW.status, 'unanswered')
  assert.deepEqual(session, original)
  draft.scoreAnswers.SW.rationale = 'Intentional non-inferability'
  assert.equal(legacyDraft(implied, draft).scoreAnswers.SW.status, 'not_inferable')
  assert.equal(draftFromResponse(implied, responseForDraft(implied, draft)).scoreAnswers.SW.status, 'not_inferable')
  assert.equal(draftFromResponse(implied, responseForDraft(implied, draft)).scoreAnswers.UA.status, 'unanswered')
  session.pending_editors = {}
  assert.equal((await validateSession(session)).drafts[implied.packet_id].scoreAnswers.UA.status, 'not_inferable')
})

test('wrapper rejects unknown fields, invalid active anchors, missing and extra drafts', async () => {
  for (const mutate of [session => { session.extra = true }, session => { session.active_index = 999 }, session => { session.active_criterion = -1 }, session => { session.active_task = 'unknown' }, session => { session.drafts.extra = emptyDraft(packets[0]) }, session => { delete session.drafts[packets[0].packet_id] }, session => { session.bundle_sha256 = 'bad' }, session => { session.evaluator_id = '' }]) {
    const session = await fresh()
    mutate(session)
    await assert.rejects(validateSession(session))
  }
})

test('draft validation rejects arbitrary fields, invalid scores, IDs, statuses and confidence', () => {
  for (const mutate of [draft => { draft.extra = true }, draft => { draft.scoreAnswers.extra = draft.scoreAnswers.SW }, draft => { draft.scoreAnswers.SW.status = 'unknown' }, draft => { draft.scoreAnswers.SW.confidence = 'unknown' }, draft => { draft.scoreAnswers.SW.rationale = 1 }, draft => { draft.scoreAnswers.SW.score = Infinity }, draft => { draft.scoreAnswers.SW.score = 0 }, draft => { draft.scoreAnswers.SW.feedback_evidence = [{}] }]) {
    const draft = emptyDraft(implied)
    mutate(draft)
    assert.throws(() => validateDraft(implied, draft))
  }
})

test('source excerpts retain original offsets and reject forged quotes or bounds', () => {
  const draft = emptyDraft(implied)
  const answer = draft.scoreAnswers.SW
  Object.assign(answer, { status: 'inferred_from_feedback', score: 1.7, confidence: 'medium', rationale: 'Reason', feedback_evidence: [{ start_character: 0, end_character: 4, quote: implied.human_feedback.slice(0, 4) }] })
  assert.deepEqual(validateDraft(implied, draft), draft)
  answer.feedback_evidence[0].quote = 'Forged'
  assert.throws(() => validateDraft(implied, draft), /Quelle/)
  answer.feedback_evidence[0].end_character = 999999
  assert.throws(() => validateDraft(implied, draft), /position/)
})

test('span comments validate component, item, tags and anchored reflection IDs', () => {
  const draft = emptyDraft(quality)
  const comment = { feedback_component: 'strengths', feedback_item_index: 0, start_character: 0, end_character: 3, comment: 'Note', tags: ['strength'], linked_reflection_segment_ids: [quality.reflection.segments[0].segment_id] }
  draft.spanComments.push(comment)
  assert.deepEqual(validateDraft(quality, draft), draft)
  for (const patch of [{ feedback_component: 'unknown' }, { feedback_item_index: 999 }, { tags: ['unknown'] }, { linked_reflection_segment_ids: ['unknown'] }, { start_character: -1 }, { extra: true }]) {
    assert.throws(() => validateDraft(quality, { ...draft, spanComments: [{ ...comment, ...patch }] }))
  }
})

test('legacy response recovery retains research numeric/null serializers and latest edits', () => {
  const draft = emptyDraft(quality)
  for (const answer of Object.values(draft.criterionRatings)) answer.score = quality.scale?.min ?? 1
  assert.deepEqual(draftFromResponse(quality, responseForDraft(quality, draft)), draft)
  draft.overallComment = 'Latest edit'
  assert.equal(responseForDraft(quality, draft).overall_comment, 'Latest edit')
  const unable = Object.values(draft.criterionRatings)[0]
  unable.score = null
  unable.unable_to_judge = true
  unable.comment = 'Reason'
  assert.equal(Object.values(responseForDraft(quality, draft).criterion_ratings)[0].score, null)
})

test('content hash mismatches reject imports', async () => {
  await assert.rejects(checkPacketHashes([{ ...implied, displayed_reflection_sha256: '0'.repeat(64) }]), /Prüfsumme/)
})

test('enum fields cannot be smuggled through array-to-string coercion', () => {
  assert.throws(() => validatePackets([{ ...quality, task: ['feedback_quality'] }]))
  const draft = emptyDraft(implied)
  draft.scoreAnswers.SW.status = ['unanswered']
  assert.throws(() => validateDraft(implied, draft))
  const annotated = emptyDraft(quality)
  annotated.spanComments.push({ feedback_component: 'strengths', feedback_item_index: 0, start_character: 0, end_character: 3, comment: '', tags: [['strength']], linked_reflection_segment_ids: [] })
  assert.throws(() => validateDraft(quality, annotated))
})

test('workbench typechecks against the agreed shared interfaces without writing shared files', () => {
  const root = new URL('../', import.meta.url).pathname
  const virtual = new Map([
    [join(root, 'src/localSessions.ts'), 'export declare function readSession<T>(key: string): Promise<T | undefined>; export declare function writeSession(key: string, value: unknown): Promise<void>; export declare function listSessions<T>(prefix: string): Promise<{key: string; value: T}[]>;'],
    [join(root, 'src/WorkflowSupport.tsx'), `import type { ReactNode } from 'react';
      export declare function WorkflowHelp(props: {review?: boolean}): ReactNode;
      export declare function ResumePrompt(props: {count: number; total: number; onContinue: () => void; onRestart: () => void; onCancel: () => void; review?: boolean}): ReactNode;
      export declare function ExportSummary(props: {total: number; complete: number; started: number; onExport: () => void; onClose: () => void; review?: boolean; feedback?: boolean}): ReactNode;
      export declare function PersistenceStatus(props: {state: 'saving' | 'saved' | 'error' | 'idle'}): ReactNode;`],
    [join(root, 'src/PacketNavigator.tsx'), `import type {ReactNode} from 'react'; import type {CaseState} from './ratingValidation';
      declare function PacketNavigator(props: {label: string; states: CaseState[]; activeIndex: number; onNavigate: (index: number) => void; children: ReactNode; review?: boolean}): ReactNode; export default PacketNavigator;`],
  ])
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, noUnusedLocals: true, noUnusedParameters: true, types: ['vite/client'] }
  const host = ts.createCompilerHost(options)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getCurrentDirectory = () => root
  host.fileExists = path => virtual.has(path) || fileExists(path)
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => virtual.has(path) ? ts.createSourceFile(path, virtual.get(path), languageVersion, true) : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([join(root, 'src/RatingWorkbench.tsx')], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n' }))
})