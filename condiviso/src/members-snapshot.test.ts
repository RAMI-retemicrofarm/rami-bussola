import { describe, expect, it } from 'vitest'
import { MEMBERS_KEY, parseMembersSnapshot, type MembersSnapshot } from './members-snapshot.ts'

const snapshot: MembersSnapshot = {
  version: 1,
  publishedAt: '2027-02-01T08:00:00.000Z',
  asOf: '2027-02-01',
  counts: { inGoodStanding: 150, paidAhead: 3, dueForRenewal: 110, notInGoodStanding: 7, left: 12, members: 270 },
  renewals: { year: 2027, renewed: 150, base: 260, percent: 58, until: '03-31' },
}

describe('parseMembersSnapshot', () => {
  it('la chiave è a parte dalla riservata', () => {
    expect(MEMBERS_KEY).toBe('v1/soci.json')
  })

  it('legge un’istantanea con la forma giusta, anche senza la riga dei rinnovi', () => {
    expect(parseMembersSnapshot(snapshot)).toEqual(snapshot)
    expect(parseMembersSnapshot({ ...snapshot, renewals: null })).toEqual({ ...snapshot, renewals: null })
    expect(parseMembersSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('rifiuta ciò che non ha la forma giusta: solo numeri, nessun nome', () => {
    expect(parseMembersSnapshot(null)).toBeNull()
    expect(parseMembersSnapshot({ ...snapshot, version: 2 })).toBeNull()
    expect(parseMembersSnapshot({ ...snapshot, asOf: '1/2/2027' })).toBeNull()
    expect(parseMembersSnapshot({ ...snapshot, counts: { ...snapshot.counts, members: '270' } })).toBeNull()
    expect(parseMembersSnapshot({ ...snapshot, counts: { inGoodStanding: 1 } })).toBeNull()
    expect(parseMembersSnapshot({ ...snapshot, renewals: { ...snapshot.renewals, until: '31/3' } })).toBeNull()
  })

  it('i campi che non conosce non passano: una lista di nomi non ha posto', () => {
    const parsed = parseMembersSnapshot({ ...snapshot, names: ['Anna Esempio'] })
    expect(parsed).toEqual(snapshot)
    expect(JSON.stringify(parsed)).not.toContain('Anna')
  })
})
