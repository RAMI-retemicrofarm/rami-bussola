import { describe, expect, it } from 'vitest'
import { parseUsageKey, saltKey, usageArea, usageKey, usageMonth } from './index.ts'

describe('le chiavi dell’uso', () => {
  it('una per mese, area e impronta; il sale a parte', () => {
    const fingerprint = 'a'.repeat(64)
    expect(usageKey('2026-11', 'coordinamento', fingerprint)).toBe(`uso:2026-11:coordinamento:${fingerprint}`)
    expect(parseUsageKey(usageKey('2026-11', 'coordinamento', fingerprint))).toEqual({
      month: '2026-11',
      area: 'coordinamento',
      fingerprint,
    })
    expect(saltKey('2026-11')).toBe('uso-sale:2026-11')
    expect(parseUsageKey(saltKey('2026-11'))).toBeNull()
    expect(parseUsageKey('uso:2026-11:altro:x')).toBeNull()
  })

  it('il mese è quello di Roma', () => {
    expect(usageMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11')
  })
})

describe('in quale conteggio si entra', () => {
  it('su pages.dev contano Direttivo e rappresentanti, il Coordinamento', () => {
    expect(usageArea({ roles: ['board'] }, 'riservata')).toBe('coordinamento')
    expect(usageArea({ roles: ['rep'] }, 'riservata')).toBe('coordinamento')
    expect(usageArea({ roles: ['board', 'office'] }, 'riservata')).toBe('coordinamento')
    expect(usageArea({ roles: ['board', 'rep'] }, 'riservata')).toBe('coordinamento')
  })

  it('chi ha solo segreteria o cura della Bussola non conta in nessuno dei due', () => {
    for (const roles of [['office'], ['keeper'], ['office', 'keeper']] as const) {
      expect(usageArea({ roles: [...roles] }, 'riservata')).toBeNull()
      expect(usageArea({ roles: [...roles] }, 'soci')).toBeNull()
    }
  })

  it('un socio che è anche Persona della Riservata esce dal conteggio dei soci', () => {
    expect(usageArea(null, 'soci')).toBe('soci')
    expect(usageArea({ roles: ['board'] }, 'soci')).toBeNull()
    expect(usageArea({ roles: [] }, 'soci')).toBeNull()
  })
})
