import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkClientScripts, clientScripts, LIMIT_BYTES } from './js-size.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function dist(files: Record<string, string | Buffer>) {
  const folder = mkdtempSync(join(tmpdir(), 'bussola-dist-'))
  folders.push(folder)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(folder, name, '..'), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
  return folder
}

describe('il JavaScript per il browser', () => {
  it('conta ogni .js e .mjs, anche nelle cartelle, ma non la Function', () => {
    const scripts = clientScripts(
      dist({ '_worker.js': 'x'.repeat(5000), 'static/a.js': 'let a = 1', 'b.mjs': 'export {}', 'style.css': 'a{}' }),
    )
    expect(scripts.map((script) => script.file).sort()).toEqual(['b.mjs', join('static', 'a.js')])
  })

  it('misura i byte compressi con gzip, col limite di 10 KB', () => {
    const [script] = clientScripts(dist({ 'a.js': 'a'.repeat(100_000) }))
    expect(script?.gzip).toBeLessThan(1000)
    expect(LIMIT_BYTES).toBe(10_240)
  })

  it('sopra i 10 KB compressi ferma il build con l’errore; sotto, e senza contare la Function, no', () => {
    // Byte a caso: gzip non li comprime, e due file da 6 KB superano il limite insieme.
    const noise = () => randomBytes(6_000)
    const over = checkClientScripts(dist({ 'a.js': noise(), 'static/b.mjs': noise(), '_worker.js': noise() }))
    expect(over.error).toBe('Troppo JavaScript: il limite è 10 KB compressi con gzip.')
    expect(over.lines).toHaveLength(3)
    expect(over.lines[2]).toMatch(/^JavaScript per il browser: 1[12]\d{3} byte con gzip, su 10240 ammessi\.$/)
    const under = checkClientScripts(dist({ 'a.js': noise(), '_worker.js': noise().toString('hex').repeat(10) }))
    expect(under.error).toBeNull()
    expect(under.lines[1]).toMatch(/^JavaScript per il browser: 6\d{3} byte con gzip, su 10240 ammessi\.$/)
  })
})
