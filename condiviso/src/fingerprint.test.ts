import { describe, expect, it } from 'vitest'
import { bytesToHex, FINGERPRINT_VECTOR, normalizeEmail } from './fingerprint.ts'

// Il vettore lo provano i due runtime che fanno lo SHA-256: la vetrina con Web Crypto, il motore con il suo digest.
describe('normalizeEmail', () => {
  it('toglie gli spazi e porta tutto in minuscolo', () => {
    expect(normalizeEmail('  Direttivo@Example.ORG ')).toBe('direttivo@example.org')
  })

  it('il vettore di prova parte da una mail da normalizzare', () => {
    expect(normalizeEmail(FINGERPRINT_VECTOR.email)).not.toBe(FINGERPRINT_VECTOR.email)
  })
})

describe('bytesToHex', () => {
  it('scrive i byte in esadecimale, anche quelli con il segno che dà Apps Script', () => {
    expect(bytesToHex([0, 15, 16, 255])).toBe('000f10ff')
    expect(bytesToHex([-1, -128, 127])).toBe('ff807f')
  })
})
