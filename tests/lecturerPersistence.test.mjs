import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const domain = require(process.env.PREBI_LECTURER_SESSION_MODULE)
const { SYNTHETIC_CASE } = require(process.env.PREBI_LECTURER_SERVICE_MODULE)
const localModule = join(dirname(process.env.PREBI_LECTURER_PERSISTENCE_MODULE), 'localSessions.js')
const entries = new Map()
let failure = null
let writes = 0
require.cache[localModule] = {
  id: localModule, filename: localModule, loaded: true,
  exports: {
    async readSession(key) { if (failure) throw failure; return structuredClone(entries.get(key)) },
    async writeSession(key, value) { if (failure) throw failure; writes++; entries.set(key, structuredClone(value)) },
    async deleteSession(key) { if (failure) throw failure; entries.delete(key) },
  },
}
const { LecturerPersistence, LECTURER_STORAGE_KEY } = require(process.env.PREBI_LECTURER_PERSISTENCE_MODULE)
const newSession = () => domain.createLecturerSession(SYNTHETIC_CASE, 'test-case')
let lockQueue = Promise.resolve()
const locks = { request(_name, action) {
  const pending = lockQueue.then(action)
  lockQueue = pending.catch(() => {})
  return pending
} }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })

test('isolated storage queues writes, snapshots values and deletes only its own namespace', async () => {
  entries.clear()
  entries.set('research::untouched', { preserve: true })
  const storage = new LecturerPersistence()
  assert.equal(await storage.load(), null)
  const first = newSession()
  const second = domain.setScore(first, 'SW', 1)
  const one = storage.save(first)
  const two = storage.save(second)
  second.scores.SW = 3
  await Promise.all([one, two])
  assert.equal(entries.get(LECTURER_STORAGE_KEY).scores.SW, 1)
  await storage.save(null)
  assert.equal(entries.has(LECTURER_STORAGE_KEY), false)
  assert.deepEqual(entries.get('research::untouched'), { preserve: true })
})

test('cross-tab conflict blocks all subsequent writes instead of overwriting', async () => {
  entries.clear()
  writes = 0
  const first = new LecturerPersistence()
  const second = new LecturerPersistence()
  await Promise.all([first.load(), second.load()])
  await first.save(newSession())
  await assert.rejects(second.save(domain.setScore(newSession(), 'SW', 2)), /anderes Fenster/)
  await assert.rejects(second.save(null))
  assert.equal(writes, 1)
  assert.equal(entries.get(LECTURER_STORAGE_KEY).scores.SW, null)
})

test('simultaneous tabs serialize check/write under the same lock', async () => {
  entries.clear()
  const first = new LecturerPersistence()
  const second = new LecturerPersistence()
  await Promise.all([first.load(), second.load()])
  const results = await Promise.allSettled([first.save(newSession()), second.save(domain.setScore(newSession(), 'SW', 2))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
})

test('unsupported Web Locks and quota failures are explicit, not success-shaped fallbacks', async () => {
  entries.clear()
  const unsupported = new LecturerPersistence()
  await unsupported.load()
  navigator.locks = undefined
  await assert.rejects(unsupported.save(newSession()), /tabübergreifende/)
  navigator.locks = locks
  const storage = new LecturerPersistence()
  await storage.load()
  failure = new Error('QuotaExceededError')
  await assert.rejects(storage.save(newSession()), /QuotaExceededError/)
  failure = null
  await assert.rejects(storage.save(newSession()))
  assert.equal(entries.has(LECTURER_STORAGE_KEY), false)
})

test('unknown/corrupt versions are not overwritten on load; explicit replacement is possible', async () => {
  entries.clear()
  const invalid = { ...newSession(), schema_version: '99.0.0' }
  entries.set(LECTURER_STORAGE_KEY, invalid)
  const storage = new LecturerPersistence()
  await assert.rejects(storage.load(), /nicht unterstützte/)
  assert.deepEqual(entries.get(LECTURER_STORAGE_KEY), invalid)
  await storage.save(null)
  assert.equal(entries.has(LECTURER_STORAGE_KEY), false)
})

test('recovered interrupted requests keep the raw persisted fingerprint for the next save', async () => {
  entries.clear()
  let pending = newSession()
  for (const dimension of domain.DIMENSIONS) pending = domain.setScore(pending, dimension, 1)
  pending = domain.beginAttempt(domain.confirmScores(pending, '2026-11-09T12:00:00.000Z'), 'G1', 'attempt-1')
  entries.set(LECTURER_STORAGE_KEY, pending)
  const storage = new LecturerPersistence()
  const restored = await storage.load()
  assert.equal(restored.candidates.G1.status, 'interrupted')
  await storage.save(restored)
  assert.equal(entries.get(LECTURER_STORAGE_KEY).candidates.G1.status, 'interrupted')
})
