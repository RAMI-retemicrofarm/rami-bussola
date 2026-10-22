import { DEFAULT_DUES_SETTINGS, romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { SOCI_SHEETS } from './members.ts'
import { migrateRegister } from './migration.ts'

const today = '2026-10-20'
// A mezzogiorno UTC, così il giorno è lo stesso a Roma.
const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

const HEADER = [
  'N. socio',
  'Cognome',
  'NOME',
  'E-mail',
  'Cellulare',
  'Categoria',
  'Data iscrizione',
  'Delibera',
  'Data  recesso',
  'Note',
  'Codice fiscale',
  'Luogo di nascita',
  'Quota 2025',
  2026,
]

type More = { tipo?: string; ammesso?: unknown; recesso?: unknown; note?: string }

/** Una riga del libro finto: i nomi sono inventati. */
const row = (n: unknown, surname: string, name: string, q2025: unknown, q2026: unknown, more: More = {}) => [
  n,
  surname,
  name,
  surname ? `${surname.toLowerCase()}@esempio.it` : 'senza.nome@esempio.it',
  3330000000 + Number(n || 0),
  more.tipo ?? '',
  more.ammesso ?? day('2019-03-01'),
  'Verbale 2019/1',
  more.recesso ?? '',
  more.note ?? '',
  `CF${String(n)}`,
  'Ravenna',
  q2025,
  q2026,
]

// Righe 2…32 del libro; la 19 è vuota, con le caselle di Google a FALSE.
const REGISTER: unknown[][] = [
  HEADER,
  row(1, 'Abete', 'Anna', '✓', '✓', { tipo: 'Produttore' }), // 2
  row(2, 'Betulla', 'Bruno', 'x', 'X', { tipo: 'Sostenitore' }), // 3
  row(3, 'Cedro', 'Carla', true, true, { tipo: 'non produttore' }), // 4
  row(4, 'Faggio', 'Dario', 30, 30, { tipo: 'professionista' }), // 5
  row(5, 'Gelso', 'Elena', day('2025-02-10'), day('2026-01-15')), // 6
  row(6, 'Larice', 'Fabio', 'sì', ''), // 7
  row(7, 'Melo', 'Giulia', '', 'forse'), // 8
  row(8, 'Noce', 'Ivo', '✔', 'si'), // 9
  row(9, 'Olmo', 'Laura', 'pagato', 1), // 10
  row(10, 'Pino', 'Marco', false, 'no'), // 11
  row(11, 'Quercia', 'Nadia', 0, '-'), // 12
  row(12, 'Rovere', 'Oscar', '✓', '✓', { recesso: '01/05/2026' }), // 13
  row(13, 'Salice', 'Paola', '?', '✓'), // 14
  row(14, 'Tiglio', 'Rita', '', 'da verificare'), // 15
  row('', 'Ulivo', 'Sara', '', '✓'), // 16: senza numero
  row(3, 'Vite', 'Tommaso', '', '✓'), // 17: numero doppio
  row(15, '', '', '', ''), // 18: né cognome né nome
  ['', '', '', '', '', '', '', '', '', '', '', '', false, false], // 19: vuota
  row(16, 'Zucca', 'Ugo', '', '✓', { ammesso: 'primavera 2019' }), // 20
  row(17, 'Acero', 'Vera', '', '✓', { tipo: 'socio fondatore' }), // 21
  row(18, 'Bosso', 'Walter', '✓', '✓'), // 22
  row(19, 'Carpino', 'Zeno', '✓', '✓'), // 23
  row(20, 'Edera', 'Alba', '✓', '✓'), // 24
  row(21, 'Fico', 'Bice', '✓', '✓'), // 25
  row(22, 'Glicine', 'Ciro', '✓', '✓'), // 26
  row(23, 'Ibisco', 'Dora', '✓', '✓', { recesso: day('2026-12-31') }), // 27: recede dopo oggi
  row(24, 'Lauro', 'Ezio', '✓', '', { recesso: '2025-06-30' }), // 28
  row(25, 'Mirto', 'Flora', '✓', ''), // 29
  row(26, 'Nespolo', 'Gino', '✓', ''), // 30
  row(27, 'Oleandro', 'Ida', '✓', ''), // 31
  row(28, 'Pioppo', 'Leo', '✓', ''), // 32
]

// 17 pagamenti in dubbio: due del 2025, una data che manca, un importo che non si legge.
const DOUBTFUL: unknown[][] = [
  ['Data', 'Importo', 'Causale', 'Riferimento', 'Modo'],
  ...Array.from({ length: 17 }, (_, i) => {
    const n = i + 1
    const date = n <= 2 ? day(`2025-11-0${n}`) : n === 16 ? '' : day(`2026-0${(n % 9) + 1}-1${n % 10}`)
    const amount = n === 17 ? 'trenta' : n === 5 ? '30,00 €' : 30
    return [date, amount, `quota rami ${n}`, `CRO${n}`, n === 3 ? 'contanti' : '']
  }),
]

const migrate = (register = REGISTER, doubtful: unknown[][] | null = DOUBTFUL) =>
  migrateRegister({ register, doubtful, today, settings: DEFAULT_DUES_SETTINGS, toCalendarDate: romeDate })

const has = (report: readonly string[], ...parts: string[]) =>
  report.some((line) => parts.every((part) => line.includes(part)))

describe('migrateRegister, il libro finto', () => {
  const result = migrate()
  const member = (n: string) => result.members.find((m) => m.numero === n)
  const paymentsOf = (n: string) => result.payments.filter((p) => p['numero socio'] === n)

  it('porta in Soci le righe con numero e nome, con le colonne in più dopo quelle della Bussola', () => {
    expect(result.ok).toBe(true)
    expect(result.extraColumns).toEqual(['Codice fiscale', 'Luogo di nascita'])
    expect(result.members).toHaveLength(27)
    expect(Object.keys(result.members[0] ?? {})).toEqual([
      ...SOCI_SHEETS.members.columns,
      'Codice fiscale',
      'Luogo di nascita',
    ])
    expect(member('1')).toEqual({
      numero: '1',
      cognome: 'Abete',
      nome: 'Anna',
      mail: 'abete@esempio.it',
      telefono: '3330000001',
      tipo: 'professionista',
      'ammesso il': '2019-03-01',
      delibera: 'Verbale 2019/1',
      'receduto il': '',
      note: '',
      'Codice fiscale': 'CF1',
      'Luogo di nascita': 'Ravenna',
    })
    expect(member('2')?.tipo).toBe('sostenitore')
    expect(member('3')?.tipo).toBe('sostenitore')
    expect(member('3')?.cognome).toBe('Cedro') // il doppio della riga 17 non sovrascrive
    expect(member('12')?.['receduto il']).toBe('2026-05-01')
    expect(member('23')?.['receduto il']).toBe('2026-12-31')
    // Una data che non si legge non entra in Soci, dove fermerebbe la pagina della segreteria: va nella nota.
    expect(member('16')?.['ammesso il']).toBe('')
    expect(member('16')?.note).toBe('ammesso il, nel libro: primavera 2019')
    expect(member('17')?.tipo).toBe('')
    expect(member('15')).toBeUndefined()
    expect(result.members.some((m) => m.cognome === 'Ulivo' || m.cognome === 'Vite')).toBe(false)
  })

  it('fa un pagamento per ogni casella spuntata, numerato per anno in ordine di riga', () => {
    const fromBoxes = result.payments.filter((p) => p['numero socio'] !== '')
    expect(fromBoxes.filter((p) => p["vale per l'anno"] === 2025)).toHaveLength(20)
    expect(fromBoxes.filter((p) => p["vale per l'anno"] === 2026)).toHaveLength(17)
    expect(paymentsOf('1')).toEqual([
      {
        id: 'L-2025-0001',
        'numero socio': '1',
        "vale per l'anno": 2025,
        importo: 30,
        data: '',
        modo: 'libro soci',
        riferimento: '',
        'chi incassa': '',
        'registrato da': 'libro soci',
        account: '',
        'registrato il': '2026-10-20',
        'contanti ricevuti il': '',
        stato: 'registrato',
        'motivo o nota': 'dal libro soci, colonna «Quota 2025»',
        'chiave della registrazione': '',
      },
      expect.objectContaining({
        id: 'L-2026-0001',
        "vale per l'anno": 2026,
        'motivo o nota': 'dal libro soci, colonna «2026»',
      }),
    ])
    expect(paymentsOf('12').map((p) => p.id)).toEqual(['L-2025-0009', 'L-2026-0008'])
    expect(paymentsOf('23').map((p) => p.id)).toEqual(['L-2025-0015', 'L-2026-0017'])
    // Una cifra o una data nella casella restano nella nota; l'importo è quello della quota.
    expect(paymentsOf('4')[1]).toMatchObject({ importo: 30, 'motivo o nota': 'dal libro soci, colonna «2026»: «30»' })
    expect(paymentsOf('5')[1]?.['motivo o nota']).toBe('dal libro soci, colonna «2026»: «15/01/2026»')
    expect(paymentsOf('7')).toEqual([])
    expect(paymentsOf('13').map((p) => p["vale per l'anno"])).toEqual([2026])
    expect(paymentsOf('14')).toEqual([])
    expect(paymentsOf('10')).toEqual([])
    expect(paymentsOf('11')).toEqual([])
  })

  it('mette i 17 pagamenti in dubbio in «Da abbinare», dopo le quote', () => {
    const toMatch = result.payments.filter((p) => p['numero socio'] === '')
    expect(toMatch).toHaveLength(17)
    expect(toMatch.map((p) => p.id)).toEqual([
      'L-2025-0021',
      'L-2025-0022',
      ...Array.from({ length: 15 }, (_, i) => `L-2026-${String(18 + i).padStart(4, '0')}`),
    ])
    expect(toMatch[0]).toEqual({
      id: 'L-2025-0021',
      'numero socio': '',
      "vale per l'anno": 2025,
      importo: 30,
      data: '2025-11-01',
      modo: 'bonifico',
      riferimento: 'CRO1',
      'chi incassa': '',
      'registrato da': 'libro soci',
      account: '',
      'registrato il': '2026-10-20',
      'contanti ricevuti il': '',
      stato: 'registrato',
      'motivo o nota': 'in dubbio dalla migrazione: «quota rami 1»',
      'chiave della registrazione': '',
    })
    expect(toMatch[2]?.modo).toBe('contanti')
    expect(toMatch[4]?.importo).toBe(30)
    expect(toMatch[15]).toMatchObject({ data: '', "vale per l'anno": 2026 })
    expect(toMatch[16]?.importo).toBe(30)
    expect(has(result.report, '17 pagamenti in dubbio', '«Da abbinare»')).toBe(true)
    expect(has(result.report, 'riga 18', '«trenta»', '30 €')).toBe(true)
  })

  it('fa tornare i conti: righe con dati = portate + non portate, e gli in regola contati a mano', () => {
    // 31 righe sotto l'intestazione, una vuota: 30 con dati. Non passano la 16, la 17 e la 18.
    // Quota 2026 spuntata fra le portate: n. 1, 2, 3, 4, 5, 8, 9, 12, 13, 16, 17, 18…23 = 17.
    // La Bussola toglie il n. 12, receduto il 01/05/2026: 16. Il n. 23 recede a fine anno e conta.
    expect(result.counts).toEqual({
      registerRows: 30,
      migrated: 27,
      notMigrated: 3,
      inGoodStandingByRegister: 17,
      inGoodStandingByBussola: 16,
      doubtful: 17,
    })
    expect(result.counts.migrated + result.counts.notMigrated).toBe(result.counts.registerRows)
  })

  it('spiega nel resoconto ogni riga che non passa e ogni casella dubbia, mai la riga vuota', () => {
    const r = result.report
    expect(has(r, '30', '27', '3')).toBe(true)
    expect(has(r, '«Codice fiscale»', '«Luogo di nascita»')).toBe(true)
    expect(has(r, 'riga 16', 'Ulivo', 'senza numero socio', 'quota 2026')).toBe(true)
    expect(has(r, 'riga 17', 'n. 3 Vite', 'riga 4')).toBe(true)
    expect(has(r, 'riga 18', 'n. 15', 'né cognome né nome')).toBe(true)
    expect(has(r, 'riga 8, n. 7 Melo: la quota 2026 dice «forse»: non la conto')).toBe(true)
    expect(has(r, 'riga 14, n. 13 Salice', 'quota 2025', '«?»')).toBe(true)
    expect(has(r, 'riga 15, n. 14 Tiglio', '«da verificare»')).toBe(true)
    expect(has(r, 'riga 20, n. 16 Zucca', '«ammesso il»', '«primavera 2019»')).toBe(true)
    expect(has(r, 'riga 21, n. 17 Acero', '«socio fondatore»')).toBe(true)
    expect(r.some((line) => line.includes('riga 19'))).toBe(false)
  })

  it('spiega riga per riga chi è in regola per il libro e non per la Bussola, o il contrario', () => {
    expect(has(result.report, 'riga 13, n. 12 Rovere: quota 2026 spuntata ma receduto il 01/05/2026')).toBe(true)
    // Controllo largo: ogni socio che sta in uno solo dei due conti ha la sua riga.
    const byRegister = new Set([
      '1',
      '2',
      '3',
      '4',
      '5',
      '8',
      '9',
      '12',
      '13',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
    ])
    const byBussola = new Set([...byRegister].filter((n) => n !== '12'))
    const differences = [...byRegister].filter((n) => !byBussola.has(n))
    expect(differences).toHaveLength(result.counts.inGoodStandingByRegister - result.counts.inGoodStandingByBussola)
    for (const n of differences) expect(has(result.report, `n. ${n} `, 'receduto')).toBe(true)
  })
})

describe('migrateRegister, le altre forme del libro', () => {
  it('con una colonna sola «Nominativo» mette tutto in cognome e lo dice', () => {
    const result = migrate(
      [
        ['Tessera', 'Nominativo', 'Posta elettronica', 'Quota anno 2026'],
        [101, 'Rossi Mario', 'mario@esempio.it', '✓'],
        [102, 'Maria Grazia Bianchi', '', ''],
      ],
      null,
    )
    expect(result.ok).toBe(true)
    expect(result.members.map((m) => [m.numero, m.cognome, m.nome, m.mail])).toEqual([
      ['101', 'Rossi Mario', '', 'mario@esempio.it'],
      ['102', 'Maria Grazia Bianchi', '', ''],
    ])
    expect(result.payments.map((p) => p.id)).toEqual(['L-2026-0001'])
    expect(has(result.report, '«Nominativo»', '«cognome»', '«nome»')).toBe(true)
    expect(result.counts).toMatchObject({ registerRows: 2, migrated: 2, inGoodStandingByRegister: 1, doubtful: 0 })
  })

  it('due colonne di quota dello stesso anno: un pagamento solo, e la seconda passa in Soci com’è', () => {
    const result = migrate(
      [
        ['N. socio', 'Cognome', 'Nome', 'Quota 2026', 2026],
        [1, 'Rossi', 'Mario', '✓', '30'],
        [2, 'Verdi', 'Anna', '', '✓'],
      ],
      null,
    )
    expect(result.payments.map((p) => [p['numero socio'], p["vale per l'anno"]])).toEqual([['1', 2026]])
    expect(result.extraColumns).toEqual(['2026'])
    expect(result.members.map((m) => m['2026'])).toEqual(['30', '✓'])
    expect(has(result.report, '«2026»', '«Quota 2026»', '2026')).toBe(true)
  })

  it('una data che non si legge lascia la cella vuota e va in coda alla nota, e il resoconto lo dice', () => {
    const result = migrate(
      [
        ['N. socio', 'Cognome', 'Ammesso il', 'Receduto il', 'Note', 'Quota 2026'],
        [1, 'Rossi', 'marzo 2019', '', '', '✓'],
        [2, 'Verdi', '01/02/2020', '12/03/19', 'socio storico', '✓'],
      ],
      null,
    )
    expect(result.members.map((m) => [m['ammesso il'], m['receduto il'], m.note])).toEqual([
      ['', '', 'ammesso il, nel libro: marzo 2019'],
      ['2020-02-01', '', 'socio storico; receduto il, nel libro: 12/03/19'],
    ])
    expect(has(result.report, 'riga 2, n. 1 Rossi', '«ammesso il»', '«marzo 2019»', 'vuota', 'nota')).toBe(true)
    expect(has(result.report, 'riga 3, n. 2 Verdi', '«receduto il»', '«12/03/19»', 'non lo conto come receduto')).toBe(
      true,
    )
  })

  it('dice quanti soci senza data di ammissione né quote conteranno come nuovi alla prima quota', () => {
    const result = migrate(
      [
        ['N. socio', 'Cognome', 'Ammesso il', 'Receduto il', 'Quota 2026'],
        [1, 'Abete', '', '', ''],
        [2, 'Betulla', '', '', '✓'],
        [3, 'Cedro', day('2019-03-01'), '', ''],
        [4, 'Faggio', 'marzo 2019', '', ''],
        [5, 'Gelso', '', '2024-01-01', ''],
      ],
      null,
    )
    expect(result.report).toContain(
      '2 soci senza data di ammissione né quote (n. 1, 4): alla prima quota conteranno come nuovi soci, e dal 15/10 ' +
        `la quota varrà per l'anno dopo. Se sono soci di anni passati, scrivi la data in «ammesso il».`,
    )
    const one = migrate(
      [
        ['N. socio', 'Cognome', 'Quota 2026'],
        [1, 'Abete', ''],
      ],
      null,
    )
    expect(one.report).toContain(
      '1 socio senza data di ammissione né quote (n. 1): alla prima quota conterà come nuovo socio, e dal 15/10 ' +
        `la quota varrà per l'anno dopo. Se è un socio di anni passati, scrivi la data in «ammesso il».`,
    )
    const known = migrate(
      [
        ['N. socio', 'Cognome', 'Quota 2026'],
        [1, 'Abete', '✓'],
      ],
      null,
    )
    expect(known.report.some((line) => line.includes('senza data di ammissione'))).toBe(false)
  })

  it('senza la colonna del numero socio si ferma e non migra niente', () => {
    const result = migrate([
      ['Cognome', 'Nome', 'Quota 2026'],
      ['Rossi', 'Mario', '✓'],
      ['Verdi', 'Anna', ''],
    ])
    expect(result.ok).toBe(false)
    expect(result.members).toEqual([])
    expect(result.payments).toEqual([])
    expect(result.counts).toMatchObject({ registerRows: 2, migrated: 0, notMigrated: 2 })
    expect(has(result.report, 'numero socio', '«Cognome»', '«Nome»', '«Quota 2026»')).toBe(true)
  })
})
