import {
  canEnter,
  HELLO_KEY,
  MEMBERS_KEY,
  normalizeEmail,
  parseReservedSnapshot,
  RESERVED_KEY,
  SITE_KEY,
  type ReservedSnapshot,
} from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEMO_EMAILS } from '../src/demo.ts'
import { readSeedPeople, seedValues } from './demo-kv.ts'

const now = new Date('2026-11-14T10:00:00Z')

// Le cinque della prova, con mail inventate: quelle vere stanno nel file del titolare, fuori dal repo.
const FIVE = [
  { mail: 'presidenza@prova.test', ruoli: 'Direttivo', 'numero socio': 12 },
  { mail: 'Orti@Prova.test', ruoli: 'rappresentante', GdL: 'GDL-orti', 'numero socio': '34' },
  { mail: 'semi@prova.test', ruoli: 'rappresentante', GdL: 'GDL-semi' },
  { mail: 'ufficio@prova.test', ruoli: 'segreteria' },
  { mail: 'bussola@prova.test', ruoli: 'cura della Bussola, Direttivo' },
]

// Come la vetrina: l'impronta della mail normalizzata, e la persona dell'istantanea che ce l'ha.
const fingerprint = (email: string) => createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex')
const reserved = (values: Map<string, string>) => parseReservedSnapshot(JSON.parse(values.get(RESERVED_KEY) ?? 'null'))
const finder = (snapshot: ReservedSnapshot | null) => (email: string) =>
  snapshot?.people.find((person) => person.fingerprint === fingerprint(email)) ?? null

describe("il seed dell'anteprima", () => {
  it('mette le cinque persone al posto di quelle inventate, e tutte entrano nella Riservata', () => {
    const values = seedValues(now, readSeedPeople(JSON.stringify(FIVE)))
    expect([...values.keys()].sort()).toEqual([HELLO_KEY, MEMBERS_KEY, RESERVED_KEY, SITE_KEY].sort())
    const snapshot = reserved(values)
    const find = finder(snapshot)
    expect(snapshot?.people).toHaveLength(5)
    expect(FIVE.map((person) => canEnter(find(person.mail)))).toEqual([true, true, true, true, true])
    expect(FIVE.map((person) => find(person.mail)?.roles)).toEqual([
      ['board'],
      ['rep'],
      ['rep'],
      ['office'],
      ['keeper', 'board'],
    ])
    expect(FIVE.map((person) => find(person.mail)?.groupId)).toEqual([null, 'GDL-orti', 'GDL-semi', null, null])
    expect(FIVE.map((person) => find(person.mail)?.memberNumber)).toEqual(['12', '34', null, null, null])
    expect(Object.values(DEMO_EMAILS).map(find)).toEqual([null, null, null, null, null])
  })

  it('delle mail, nel KV restano solo le impronte', () => {
    const written = [...seedValues(now, readSeedPeople(JSON.stringify(FIVE))).values()].join('\n').toLowerCase()
    for (const person of FIVE) expect(written).not.toContain(normalizeEmail(person.mail))
  })

  it('senza il file restano le persone inventate, quelle delle prove E2E', () => {
    const find = finder(reserved(seedValues(now)))
    expect(Object.values(DEMO_EMAILS).map((email) => canEnter(find(email)))).toEqual([true, true, true, true, true])
  })

  it('vuole fra le persone i numeri socio che gli impegni inventati citano', () => {
    const people = readSeedPeople(
      JSON.stringify(FIVE.map((person, index) => (index ? person : { ...person, 'numero socio': 7 }))),
    )
    expect(() => seedValues(now, people)).toThrow(
      'Nel file manca il numero socio 12 (Direttivo), che gli impegni inventati citano: dallo a una delle persone.',
    )
  })

  it('un ruolo che il motore non conosce ferma il seed', () => {
    const people = readSeedPeople(JSON.stringify([...FIVE, { mail: 'uno@prova.test', ruoli: 'presidente' }]))
    expect(() => seedValues(now, people)).toThrow('il ruolo «presidente» non lo conosco')
  })
})

describe('il file delle persone', () => {
  const read = (people: unknown) => () => readSeedPeople(typeof people === 'string' ? people : JSON.stringify(people))

  it('è una lista di persone in JSON', () => {
    expect(read('[{"mail": "uno@prova.test",')).toThrow('non si legge come JSON')
    expect(read([])).toThrow('almeno una persona')
    expect(read({ mail: 'uno@prova.test', ruoli: 'Direttivo' })).toThrow('almeno una persona')
    expect(read(['uno@prova.test'])).toThrow('La persona n. 1 non ha la forma giusta')
  })

  it('ogni persona ha mail e ruoli, e nient’altro che mail, ruoli, GdL e numero socio', () => {
    expect(read([{ ruoli: 'Direttivo' }])).toThrow('La persona n. 1: manca la mail.')
    expect(read([{ mail: 'uno', ruoli: 'Direttivo' }])).toThrow('La persona n. 1: la mail non ha la chiocciola.')
    expect(read([{ mail: 'uno@prova.test' }])).toThrow('La persona n. 1: mancano i ruoli.')
    expect(read([{ mail: 'uno@prova.test', ruoli: 'Direttivo', gdl: 'GDL-orti' }])).toThrow('«gdl» non la conosco')
    expect(read([{ mail: 'uno@prova.test', ruoli: 'Direttivo', 'numero socio': true }])).toThrow(
      'il numero socio va scritto come numero',
    )
  })

  it('chi è rappresentante ha uno dei GdL inventati', () => {
    expect(read([{ mail: 'uno@prova.test', ruoli: 'rappresentante' }])).toThrow(
      'La persona n. 1 è rappresentante: le serve uno dei GdL inventati, GDL-orti, GDL-semi',
    )
    expect(read([{ mail: 'uno@prova.test', ruoli: 'Rappresentante', GdL: 'Orti' }])).toThrow(
      'le serve uno dei GdL inventati',
    )
  })

  it('una mail compare una volta sola, anche con le maiuscole', () => {
    expect(
      read([
        { mail: 'uno@prova.test', ruoli: 'Direttivo' },
        { mail: 'due@prova.test', ruoli: 'segreteria' },
        { mail: ' UNO@prova.test', ruoli: 'segreteria' },
      ]),
    ).toThrow('La persona n. 3 ha la stessa mail della n. 1.')
  })

  it('nei messaggi non scrive le mail', () => {
    const messages = [
      '[{"mail": "uno@prova.test",',
      [{ mail: 'uno@prova.test' }],
      [{ mail: 'uno@prova.test', ruoli: 'rappresentante', GdL: 'due@prova.test' }],
      [{ mail: 'uno@prova.test', ruoli: 'Direttivo', 'numero socio': ['tre@prova.test'] }],
      [
        { mail: 'uno@prova.test', ruoli: 'Direttivo' },
        { mail: 'uno@prova.test', ruoli: 'Direttivo' },
      ],
    ].map((people) => {
      try {
        read(people)()
        return 'nessun errore'
      } catch (error) {
        return String(error)
      }
    })
    expect(messages.filter((message) => message === 'nessun errore' || message.includes('@'))).toEqual([])
  })
})
