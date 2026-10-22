import { parseHello } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { buildHello } from './hello.ts'

describe('buildHello', () => {
  it('scrive un valore che la vetrina accetta, con l’ora in UTC', () => {
    const hello = buildHello(new Date('2026-10-18T21:00:00+02:00'))
    expect(parseHello(hello)).toEqual(hello)
    expect(hello.writtenAt).toBe('2026-10-18T19:00:00.000Z')
  })
})
