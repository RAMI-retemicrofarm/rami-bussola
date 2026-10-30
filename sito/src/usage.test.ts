import { normalizeEmail, saltKey, usageKey, type ReservedPerson, type Role } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './identity.ts'
import { EMAILS, memoryKvNamespace, requestPage, reservedFixture } from './testing.ts'
import { count, usageFingerprint } from './usage.ts'

const october = new Date('2026-10-20T10:00:00Z')
const november = new Date('2026-11-03T10:00:00Z')
const person = { memberNumber: '34', email: EMAILS.rep }

/** Le chiavi dell'uso scritte nel KV, senza il sale. */
const usageKeys = (kv: ReturnType<typeof memoryKvNamespace>) =>
  [...kv.store.keys()].filter((key) => key.startsWith('uso:'))

describe('count', () => {
  it('la stessa persona che entra 10 volte in un mese conta 1', async () => {
    const kv = memoryKvNamespace()
    for (let i = 0; i < 10; i++) await count(person, 'coordinamento', new Date(october.getTime() + i * 3_600_000), kv)
    expect(usageKeys(kv)).toHaveLength(1)
    // Si scrive solo se è nuova: una scrittura per la chiave, una per il sale.
    expect(kv.puts.filter((key) => key.startsWith('uso:'))).toHaveLength(1)
  })

  it('la chiave è uso:<mese>:<area>:<impronta>, e scade al più dopo 70 giorni', async () => {
    const kv = memoryKvNamespace()
    const key = await count(person, 'coordinamento', october, kv)
    expect(key).toMatch(/^uso:2026-10:coordinamento:[0-9a-f]{64}$/)
    expect(kv.store.get(key ?? '')?.ttl).toBeLessThanOrEqual(70 * 86_400)
    expect(kv.store.get(saltKey('2026-10'))?.ttl).toBeLessThanOrEqual(70 * 86_400)
  })

  it('l’impronta si fa sul numero socio, o sulla mail per chi non ce l’ha; né l’uno né l’altra ci sono in chiaro', async () => {
    const kv = memoryKvNamespace({ [saltKey('2026-10')]: 'sale' })
    const byNumber = await count({ memberNumber: '34', email: 'altra@example.org' }, 'coordinamento', october, kv)
    expect(byNumber).toBe(await count({ memberNumber: '34', email: EMAILS.rep }, 'coordinamento', october, kv))
    const byEmail = await count(
      { memberNumber: null, email: ' Esterno.Semi@Example.org ' },
      'coordinamento',
      october,
      kv,
    )
    expect(byEmail).toBe(
      await count({ memberNumber: null, email: 'esterno.semi@example.org' }, 'coordinamento', october, kv),
    )
    expect(usageKeys(kv).join(' ')).not.toMatch(/socio|mail|example/)
  })

  it('le impronte di due mesi diversi non si possono legare: ogni mese ha il suo sale', async () => {
    const kv = memoryKvNamespace()
    const first = await count(person, 'coordinamento', october, kv)
    const second = await count(person, 'coordinamento', november, kv)
    expect(first?.split(':')[3]).not.toBe(second?.split(':')[3])
    expect(kv.store.get(saltKey('2026-10'))?.value).not.toBe(kv.store.get(saltKey('2026-11'))?.value)
  })

  it('buttato il sale, l’impronta del mese non si rifà più', async () => {
    const kv = memoryKvNamespace()
    const key = await count(person, 'coordinamento', october, kv)
    // Il primo del mese il motore cancella le chiavi e il sale (motore/src/usage.ts).
    kv.store.clear()
    expect(await count(person, 'coordinamento', october, kv)).not.toBe(key)
  })

  it('il sale preparato dal motore vale per tutto il mese', async () => {
    const kv = memoryKvNamespace({ [saltKey('2026-11')]: 'sale preparato' })
    const key = await count(person, 'coordinamento', november, kv)
    expect(key).toBe(usageKey('2026-11', 'coordinamento', (await usageFingerprint(person, 'sale preparato')) ?? ''))
  })

  it('senza numero socio né mail non conta nessuno', async () => {
    expect(await count({ memberNumber: null, email: '' }, 'coordinamento', october, memoryKvNamespace())).toBeNull()
  })
})

describe('chi conta su pages.dev', () => {
  /** L'istantanea con una persona sola, coi ruoli dati e la mail di prova del Direttivo. */
  async function visit(roles: Role[], times = 1) {
    const snapshot = reservedFixture()
    const fingerprint = await sha256Hex(normalizeEmail(EMAILS.board))
    const people: ReservedPerson[] = [
      { fingerprint, memberNumber: '12', roles, groupId: roles.includes('rep') ? 'GDL-orti' : null },
    ]
    const kv = memoryKvNamespace()
    for (let i = 0; i < times; i++) await requestPage('/', EMAILS.board, { reserved: { ...snapshot, people } }, kv)
    // L'istantanea del sito e quella riservata le ha scritte requestPage nel KV finto: qui contano solo le chiavi dell'uso.
    return usageKeys(kv)
  }

  it('Direttivo e rappresentanti contano per il Coordinamento', async () => {
    expect(await visit(['board'])).toEqual([expect.stringMatching(/^uso:\d{4}-\d{2}:coordinamento:/)])
    expect(await visit(['rep'])).toHaveLength(1)
  })

  it('la stessa persona che apre 10 pagine in un mese conta 1', async () => {
    expect(await visit(['board'], 10)).toHaveLength(1)
  })

  it('chi è insieme Direttivo e segreteria, o Direttivo e rappresentante, conta una volta sola', async () => {
    expect(await visit(['board', 'office'])).toHaveLength(1)
    expect(await visit(['board', 'rep'])).toHaveLength(1)
  })

  it('chi ha solo segreteria o cura della Bussola non conta', async () => {
    expect(await visit(['office'])).toEqual([])
    expect(await visit(['keeper'])).toEqual([])
    expect(await visit(['office', 'keeper'])).toEqual([])
  })

  it('chi non entra non conta', async () => {
    const kv = memoryKvNamespace()
    await requestPage('/', EMAILS.outsider, {}, kv)
    expect(usageKeys(kv)).toEqual([])
  })

  it('se KV non risponde la pagina si apre lo stesso', async () => {
    const kv = memoryKvNamespace()
    kv.put = async () => {
      throw new Error('KV giù')
    }
    const { res } = await requestPage('/', EMAILS.board, {}, kv)
    expect(res.status).toBe(200)
  })
})
