import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import type { Workbook } from './content.ts'
import { SOCI_SHEETS } from './members.ts'
import { memoryState, memoryWorkbook } from './memory.ts'
import { MIGRATION_SHEETS, runMigration } from './migration-run.ts'
import { openOffice, type OfficeDeps } from './office.ts'

const TODAY = '2026-11-05'
const SECRETARY = 'segretario@example.org'

const header = (spec: { columns: readonly string[] }) => [...spec.columns]

/** Un Foglio soci appena preparato, con la copia del libro incollata e due pagamenti in dubbio. */
function sheets(): Record<string, unknown[][]> {
  return {
    [SOCI_SHEETS.members.name]: [header(SOCI_SHEETS.members)],
    [SOCI_SHEETS.payments.name]: [header(SOCI_SHEETS.payments)],
    [SOCI_SHEETS.access.name]: [header(SOCI_SHEETS.access), ['Gino Neri', SECRETARY, 'segretario', 'sì', 'sì', 'no']],
    [SOCI_SHEETS.accessLog.name]: [header(SOCI_SHEETS.accessLog)],
    [SOCI_SHEETS.privacyLog.name]: [header(SOCI_SHEETS.privacyLog)],
    [SOCI_SHEETS.settings.name]: [header(SOCI_SHEETS.settings)],
    [MIGRATION_SHEETS.register]: [
      ['N. socio', 'Cognome', 'Nome', 'E-mail', 'Quota 2025', 'Quota 2026', 'Codice fiscale'],
      [1, 'Rossi', 'Anna', 'anna@example.org', '✓', '✓', 'RSSNNA80A01H501X'],
      [2, 'Bianchi', 'Luca', '', '✓', '', ''],
      [3, 'Verdi', 'Sara', 'sara@example.org', '', 'x', ''],
      ['', 'Senzanumero', 'Ugo', '', '', '✓', ''],
    ],
    [MIGRATION_SHEETS.doubtful]: [
      ['data', 'importo', 'causale', 'riferimento'],
      ['2026-03-02', 30, 'quota Gialli', '9035'],
      ['2026-03-09', 30, 'quota 2026', '9041'],
    ],
  }
}

const rows = (workbook: Record<string, unknown[][]>, name: string) => (workbook[name] ?? []).slice(1)

/** Come Apps Script che si ferma a metà: la k-esima `appendRow` lancia, e quelle prima sono scritte. */
function stopsAt(data: Record<string, unknown[][]>, k: number): Workbook {
  const inner = memoryWorkbook(data)
  let calls = 0
  return {
    values: (sheet) => inner.values(sheet),
    setCell: (sheet, row, column, value) => inner.setCell(sheet, row, column, value),
    appendRow: (sheet, values) => {
      calls++
      if (calls === k) throw new Error('Superato il tempo massimo di esecuzione.')
      inner.appendRow(sheet, values)
    },
  }
}

function openFor(workbook: Workbook) {
  const deps: OfficeDeps = {
    workbook,
    email: SECRETARY,
    now: new Date(`${TODAY}T10:00:00+01:00`),
    toCalendarDate: romeDate,
    formatInstant: (instant) => instant.toISOString(),
    withLock: (run) => run(),
    sendMail: () => undefined,
    state: memoryState(),
  }
  const opened = openOffice(deps, '')
  if (opened.kind !== 'ok') throw new Error(`la pagina non si apre: ${JSON.stringify(opened)}`)
  return opened.view
}

const column = (spec: { columns: readonly string[] }, name: string) => spec.columns.indexOf(name)

describe('la migrazione del libro soci, nel Foglio soci', () => {
  it('senza la copia del libro dice cosa incollare, e non scrive niente', () => {
    const data = sheets()
    delete data[MIGRATION_SHEETS.register]
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    expect(lines[0]).toContain(`«${MIGRATION_SHEETS.register}»`)
    expect(rows(data, SOCI_SHEETS.members.name)).toEqual([])
  })

  it('in prova dà il resoconto e non scrive niente', () => {
    const data = sheets()
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: false })
    expect(lines.join('\n')).toContain('riga 5')
    expect(lines[lines.length - 1]).toBe('Prova: non ho scritto niente. Per scrivere, lancia migrateMemberRegister.')
    expect(rows(data, SOCI_SHEETS.members.name)).toEqual([])
    expect(rows(data, SOCI_SHEETS.payments.name)).toEqual([])
  })

  it('scrive i soci, con le colonne in più in fondo, e i pagamenti, con i dubbi senza socio', () => {
    const data = sheets()
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    expect(lines[lines.length - 1]).toBe('Soci scritti in «Soci»: 3. Pagamenti scritti in «Pagamenti»: 6.')
    const [membersHeader, ...members] = data[SOCI_SHEETS.members.name] ?? []
    expect(membersHeader).toEqual([...SOCI_SHEETS.members.columns, 'Codice fiscale'])
    expect(members.map((row) => row.slice(0, 3))).toEqual([
      [1, 'Rossi', 'Anna'],
      [2, 'Bianchi', 'Luca'],
      [3, 'Verdi', 'Sara'],
    ])
    expect(members[0]?.[membersHeader?.length ? membersHeader.length - 1 : 0]).toBe('RSSNNA80A01H501X')
    const payments = rows(data, SOCI_SHEETS.payments.name)
    expect(payments).toHaveLength(6)
    const memberColumn = SOCI_SHEETS.payments.columns.indexOf('numero socio')
    expect(payments.filter((row) => row[memberColumn] === '')).toHaveLength(2)
  })

  it('due intestazioni uguali a meno delle maiuscole non si sovrascrivono in Soci', () => {
    const data = sheets()
    data[MIGRATION_SHEETS.register] = [
      ['N. socio', 'Cognome', 'Nome', 'E-mail', 'Note', 'NOTE', 'Cf', 'CF', 'Quota 2026'],
      [1, 'Rossi', 'Anna', 'anna@example.org', 'prima nota', 'seconda nota', 'cf piccolo', 'CF GRANDE', '✓'],
    ]
    runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    const [membersHeader = [], first = []] = data[SOCI_SHEETS.members.name] ?? []
    const cell = (name: string) => first[membersHeader.indexOf(name)]
    expect(membersHeader.slice(SOCI_SHEETS.members.columns.length)).toEqual(['NOTE (2)', 'Cf', 'CF (2)'])
    expect([cell('note'), cell('NOTE (2)'), cell('Cf'), cell('CF (2)')]).toEqual([
      'prima nota',
      'seconda nota',
      'cf piccolo',
      'CF GRANDE',
    ])
  })

  it('non scrive in un Foglio che ha già dei soci', () => {
    const data = sheets()
    data[SOCI_SHEETS.members.name]?.push([9, 'Già', 'Qui', '', '', '', '', '', '', ''])
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    expect(lines[lines.length - 1]).toBe(
      'Non ho scritto niente: in «Soci» ci sono già righe (1). La migrazione scrive solo in «Soci» e «Pagamenti» vuoti.',
    )
    expect(rows(data, SOCI_SHEETS.payments.name)).toEqual([])
  })

  it('dopo la migrazione la pagina della segreteria conta come il resoconto', () => {
    const data = sheets()
    const workbook = memoryWorkbook(data)
    runMigration(workbook, { today: TODAY, toCalendarDate: romeDate, write: true })
    const deps: OfficeDeps = {
      workbook,
      email: SECRETARY,
      now: new Date(`${TODAY}T10:00:00+01:00`),
      toCalendarDate: romeDate,
      formatInstant: (instant) => instant.toISOString(),
      withLock: (run) => run(),
      sendMail: () => undefined,
      state: memoryState(),
    }
    const opened = openOffice(deps, '')
    if (opened.kind !== 'ok') throw new Error(`la pagina non si apre: ${JSON.stringify(opened)}`)
    // Il conto a mano: Rossi (2025 e 2026) e Verdi (2026) in regola; Bianchi (solo 2025) da rinnovare.
    expect(opened.view.counts).toMatchObject({ inGoodStanding: 2, dueForRenewal: 1, members: 3 })
  })

  it('con due date che non si leggono la pagina della segreteria si apre e conta, e le date sono nelle note', () => {
    const data = sheets()
    data[MIGRATION_SHEETS.register] = [
      ['N. socio', 'Cognome', 'Nome', 'Ammesso il', 'Receduto il', 'Note', 'Quota 2026'],
      [1, 'Rossi', 'Anna', 'marzo 2019', '', '', '✓'],
      [2, 'Bianchi', 'Luca', '2018', '12/03/19', 'socio storico', '✓'],
    ]
    const workbook = memoryWorkbook(data)
    runMigration(workbook, { today: TODAY, toCalendarDate: romeDate, write: true })
    const members = rows(data, SOCI_SHEETS.members.name)
    const note = column(SOCI_SHEETS.members, 'note')
    expect(members.map((row) => row[note])).toEqual([
      'ammesso il, nel libro: marzo 2019',
      'socio storico; ammesso il, nel libro: 2018; receduto il, nel libro: 12/03/19',
    ])
    // Il recesso che non si legge non conta: tutti e due in regola.
    expect(openFor(workbook).counts).toMatchObject({ inGoodStanding: 2, members: 2 })
  })

  it('se si ferma a metà dà il resoconto con dove si è fermato, e il rilancio finisce senza doppioni', () => {
    for (const k of [2, 6]) {
      const data = sheets()
      const stopped = runMigration(stopsAt(data, k), { today: TODAY, toCalendarDate: romeDate, write: true })
      const [members, payments] = k === 2 ? [1, 0] : [3, 2]
      expect(stopped[stopped.length - 1]).toBe(
        `Mi sono fermato dopo ${members} soci e ${payments} pagamenti: Superato il tempo massimo di esecuzione. ` +
          'Rilancia migrateMemberRegister: riparte da dove si è fermato.',
      )
      expect(stopped.join('\n')).toContain('In Soci: 3')

      const again = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
      expect(again).toContain(
        `Ripresa: c'erano già ${members} soci e ${payments} pagamenti di questa migrazione; ho scritto il resto.`,
      )
      expect(again[again.length - 1]).toBe(
        `Soci scritti in «Soci»: ${3 - members}. Pagamenti scritti in «Pagamenti»: ${6 - payments}.`,
      )
      const [membersHeader] = data[SOCI_SHEETS.members.name] ?? []
      expect(membersHeader).toEqual([...SOCI_SHEETS.members.columns, 'Codice fiscale'])
      expect(rows(data, SOCI_SHEETS.members.name).map((row) => row[0])).toEqual([1, 2, 3])
      const ids = rows(data, SOCI_SHEETS.payments.name).map((row) => row[column(SOCI_SHEETS.payments, 'id')])
      expect(ids).toHaveLength(6)
      expect(new Set(ids).size).toBe(6)
      expect(openFor(memoryWorkbook(data)).counts).toMatchObject({ inGoodStanding: 2, dueForRenewal: 1, members: 3 })
    }
  })

  it('rilanciata dopo una migrazione completa non scrive niente', () => {
    const data = sheets()
    runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    const before = JSON.stringify(data)
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    expect(lines[lines.length - 1]).toBe('La migrazione è già completa: non ho scritto niente.')
    expect(JSON.stringify(data)).toBe(before)
  })

  it('non riprende se in Pagamenti c’è anche una sola riga che non viene dalla migrazione', () => {
    const data = sheets()
    runMigration(stopsAt(data, 5), { today: TODAY, toCalendarDate: romeDate, write: true })
    const payment = SOCI_SHEETS.payments.columns.map((name) => (name === 'id' ? 'P-2026-0001' : ''))
    data[SOCI_SHEETS.payments.name]?.push(payment)
    const lines = runMigration(memoryWorkbook(data), { today: TODAY, toCalendarDate: romeDate, write: true })
    expect(lines[lines.length - 1]).toBe(
      'Non ho scritto niente: in «Pagamenti» ci sono già righe (2). La migrazione scrive solo in «Soci» e ' +
        '«Pagamenti» vuoti.',
    )
    expect(rows(data, SOCI_SHEETS.payments.name)).toHaveLength(2)
  })
})
