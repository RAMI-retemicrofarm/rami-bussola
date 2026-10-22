import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { memoryKv, memoryState } from './memory.ts'
import { publish } from './publish.ts'

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const KEY = 'v1/riservata.json'

function setup() {
  const kv = memoryKv()
  const state = memoryState()
  const run = (content: object, now = new Date('2026-10-31T10:00:00Z')) =>
    publish([{ key: KEY, content }], { kv, state, sha256Hex, now, scope: 'ns456' })
  return { kv, state, run }
}

describe('publish', () => {
  it('la prima volta scrive, con l’ora della pubblicazione', () => {
    const { kv, run } = setup()
    expect(run({ version: 1, a: 1 })).toEqual([{ key: KEY, status: 'written' }])
    expect(JSON.parse(kv.values.get(KEY) ?? '')).toEqual({ version: 1, a: 1, publishedAt: '2026-10-31T10:00:00.000Z' })
  })

  it('senza cambiamenti non scrive niente su KV', () => {
    const { kv, run } = setup()
    run({ version: 1, a: 1 })
    expect(run({ version: 1, a: 1 }, new Date('2026-10-31T10:10:00Z'))).toEqual([{ key: KEY, status: 'unchanged' }])
    expect(kv.writes).toEqual([KEY])
    expect(kv.values.get(KEY)).toContain('2026-10-31T10:00:00.000Z')
  })

  it('se il contenuto cambia, scrive di nuovo', () => {
    const { kv, run } = setup()
    run({ version: 1, a: 1 })
    run({ version: 1, a: 2 })
    expect(kv.writes).toEqual([KEY, KEY])
  })

  it('se Cloudflare non risponde, lo dice e riprova al giro dopo', () => {
    const { kv, run } = setup()
    kv.down = true
    const [failed] = run({ version: 1, a: 1 })
    expect(failed).toMatchObject({ key: KEY, status: 'failed', error: expect.stringContaining('503') })
    kv.down = false
    expect(run({ version: 1, a: 1 })).toEqual([{ key: KEY, status: 'written' }])
  })

  it('un KV nuovo riceve tutto, anche se il contenuto è lo stesso', () => {
    const { kv, state } = setup()
    const content = [{ key: KEY, content: { version: 1 } }]
    const now = new Date()
    publish(content, { kv, state, sha256Hex, now, scope: 'ns-vecchio' })
    expect(publish(content, { kv, state, sha256Hex, now, scope: 'ns-nuovo' })[0]?.status).toBe('written')
  })
})
