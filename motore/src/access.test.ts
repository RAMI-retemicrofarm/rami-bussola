import { describe, expect, it } from 'vitest'
import { accessHealth, accessList } from './access.ts'
import type { PersonRow } from './content.ts'

const person = (email: string, roles: PersonRow['roles']): PersonRow => ({
  email,
  memberNumber: null,
  roles,
  groupId: null,
})

describe('accessList', () => {
  it('ha le mail delle persone con almeno un ruolo, compresa chi cura la Bussola, nell’ordine del Foglio', () => {
    const list = accessList([
      person('direttivo@example.org', ['board']),
      person('cura@example.org', ['keeper']),
      person('senza.ruolo@example.org', []),
    ])
    expect(list).toEqual(['direttivo@example.org', 'cura@example.org'])
  })

  it('normalizza le mail e toglie i doppioni', () => {
    const list = accessList([person(' Cura@Example.org ', ['keeper']), person('cura@example.org', ['board'])])
    expect(list).toEqual(['cura@example.org'])
  })
})

describe('accessHealth', () => {
  it('la prima volta dà la lista intera da copiare in Access', () => {
    expect(accessHealth(['a@example.org', 'b@example.org'], null)).toEqual({
      status: 'a posto',
      note: 'Prima lista, da copiare in Access: a@example.org, b@example.org. In tutto 2 persone.',
      changed: true,
    })
  })

  it('quando cambia dice chi entra e chi esce', () => {
    const health = accessHealth(['a@example.org', 'c@example.org'], ['a@example.org', 'b@example.org'])
    expect(health).toEqual({
      status: 'a posto',
      note: 'Cambiata: entra c@example.org; esce b@example.org. In tutto 2 persone.',
      changed: true,
    })
  })

  it('dice solo le parti che servono', () => {
    expect(accessHealth(['a@example.org'], ['a@example.org', 'b@example.org']).note).toBe(
      'Cambiata: esce b@example.org. In tutto 1 persona.',
    )
    expect(accessHealth(['a@example.org', 'b@example.org'], ['a@example.org']).note).toBe(
      'Cambiata: entra b@example.org. In tutto 2 persone.',
    )
  })

  it('uguale, anche in un altro ordine: tiene la nota dell’ultimo cambio', () => {
    const last = 'Cambiata: entra b@example.org. In tutto 2 persone.'
    expect(accessHealth(['b@example.org', 'a@example.org'], ['a@example.org', 'b@example.org'], last)).toEqual({
      status: 'a posto',
      note: last,
      changed: false,
    })
  })

  it('con più di 50 persone è da guardare: Access gratis ne tiene 50', () => {
    const list = Array.from({ length: 51 }, (_, i) => `p${i}@example.org`)
    const health = accessHealth(list, list.slice(0, 50))
    expect(health.status).toBe('da guardare')
    expect(health.note).toBe(
      'Cambiata: entra p50@example.org. In tutto 51 persone. Sono più di 50: Access gratis ne tiene 50.',
    )
    expect(accessHealth(list, list, health.note).status).toBe('da guardare')
  })
})
