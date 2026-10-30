import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { readTable } from './content.ts'
import { DEMO_SOCI_TODAY, demoSociSheets } from './demo-soci.ts'
import { readMembers, readPayments, SOCI_SHEETS } from './members.ts'
import { memoryState, memoryWorkbook } from './memory.ts'
import {
  memberRegisterRows,
  readRegisterState,
  REGISTER_STATE_KEY,
  registerName,
  saveMemberRegister,
  type RegisterStore,
} from './register.ts'

const sheets = demoSociSheets()
const workbook = memoryWorkbook(sheets)
const members = readMembers(readTable(workbook, SOCI_SHEETS.members), romeDate)
const payments = readPayments(readTable(workbook, SOCI_SHEETS.payments), romeDate)

/** Un Drive finto: ricorda i file salvati; con `fails` non risponde. */
function store(fails = false) {
  const saved: { name: string; rows: unknown[][] }[] = []
  const drive: RegisterStore = {
    save(name, rows) {
      if (fails) throw new Error('Drive non risponde')
      saved.push({ name, rows })
      return `https://docs.google.com/spreadsheets/d/libro-${saved.length}/edit`
    },
  }
  return { drive, saved }
}

describe('memberRegisterRows', () => {
  const rows = memberRegisterRows(members, payments, DEMO_SOCI_TODAY)
  const [header = [], ...body] = rows

  it('porta solo le colonne che la legge chiede: mai mail, telefono e note', () => {
    expect(header).toEqual([
      'numero',
      'cognome',
      'nome',
      'tipo',
      'ammesso il',
      'delibera',
      'receduto il',
      'quota 2025',
      'quota 2026',
      'quota 2027',
    ])
    expect(header).not.toContain('mail')
    expect(header).not.toContain('telefono')
    expect(header).not.toContain('note')
    const text = JSON.stringify(rows)
    expect(text).not.toContain('@')
    expect(text).not.toMatch(/\d{3} ?\d{7}/)
  })

  it('un socio per riga, per numero, con le quote che contano e la data del recesso', () => {
    expect(body).toHaveLength(20)
    expect(body.map((row) => row[0])).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(body[0]).toEqual([
      1,
      'Abate',
      'Lucia',
      'professionista',
      '2020-03-14',
      '',
      '',
      '30 € il 20/01/2025 (P-2025-0001)',
      '30 € il 15/01/2026 (P-2026-0001)',
      '',
    ])
    expect(body[4]).toEqual([
      5,
      'Esposito',
      'Anna',
      'sostenitore',
      '2020-03-14',
      '',
      '2026-06-30',
      '30 € il 15/02/2025 (P-2025-0003)',
      '',
      '',
    ])
    // Le quote del libro soci non hanno data né importo; le annullate e quelle in attesa non contano.
    expect(body[10]?.slice(8)).toEqual(['dal libro soci (L-2026-0001)', ''])
    expect(body[8]?.slice(7)).toEqual(['30 € il 01/03/2025 (P-2025-0004)', '', ''])
    expect(body[9]?.slice(7)).toEqual(['30 € il 08/03/2025 (P-2025-0005)', '', ''])
    expect(body[15]?.slice(8)).toEqual(['30 € il 02/04/2026 (P-2026-0011)', '30 € il 02/04/2026 (P-2026-0012)'])
  })
})

describe('saveMemberRegister', () => {
  it('crea «Libro soci al AAAA-MM-GG» nel Drive, in sola lettura, e ricorda data e link', () => {
    const { drive, saved } = store()
    const state = memoryState()
    const result = saveMemberRegister({
      workbook,
      toCalendarDate: romeDate,
      today: DEMO_SOCI_TODAY,
      store: drive,
      state,
    })
    expect(registerName(DEMO_SOCI_TODAY)).toBe('Libro soci al 2026-11-05')
    expect(saved.map((file) => file.name)).toEqual(['Libro soci al 2026-11-05'])
    expect(saved[0]?.rows).toEqual(memberRegisterRows(members, payments, DEMO_SOCI_TODAY))
    expect(result).toEqual({
      savedOn: '2026-11-05',
      url: 'https://docs.google.com/spreadsheets/d/libro-1/edit',
      failedOn: '',
      error: '',
    })
    expect(readRegisterState(state)).toEqual(result)
    expect(state.values.has(REGISTER_STATE_KEY)).toBe(true)
  })

  it('se non riesce, ricorda il giorno e il perché, e tiene l’ultima copia riuscita', () => {
    const state = memoryState()
    saveMemberRegister({ workbook, toCalendarDate: romeDate, today: '2026-10-01', store: store().drive, state })
    const result = saveMemberRegister({
      workbook,
      toCalendarDate: romeDate,
      today: DEMO_SOCI_TODAY,
      store: store(true).drive,
      state,
    })
    expect(result).toEqual({
      savedOn: '2026-10-01',
      url: 'https://docs.google.com/spreadsheets/d/libro-1/edit',
      failedOn: '2026-11-05',
      error: 'Drive non risponde',
    })
    expect(readRegisterState(state)).toEqual(result)
  })

  it('senza niente di ricordato lo stato è vuoto', () => {
    expect(readRegisterState(memoryState())).toEqual({ savedOn: '', url: '', failedOn: '', error: '' })
  })
})
