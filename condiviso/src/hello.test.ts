import { describe, expect, it } from 'vitest'
import { parseHello } from './hello.ts'

describe('parseHello', () => {
  it('accetta il valore che scrive il motore', () => {
    const value = { version: 1, message: 'Ciao dal motore', writtenAt: '2026-10-18T19:00:00.000Z' }
    expect(parseHello(value)).toEqual(value)
  })

  it.each([
    ['niente', null],
    ['un testo', 'ciao'],
    ['una versione nuova', { version: 2, message: 'Ciao', writtenAt: '2026-10-18T19:00:00.000Z' }],
    ['un messaggio vuoto', { version: 1, message: '', writtenAt: '2026-10-18T19:00:00.000Z' }],
    ['un messaggio troppo lungo', { version: 1, message: 'a'.repeat(201), writtenAt: '2026-10-18T19:00:00.000Z' }],
    ['una data che non è una data', { version: 1, message: 'Ciao', writtenAt: 'ieri' }],
  ])('rifiuta %s', (_, value) => {
    expect(parseHello(value)).toBeNull()
  })
})
