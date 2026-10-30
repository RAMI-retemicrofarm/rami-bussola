import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import {
  ensureMeasureDeadline,
  markDeadlineDone,
  MEASURE_DEADLINE,
  measureDeadlineId,
  measureObjective,
  readOfficeDeadlines,
  writeMeasure,
} from './agenda.ts'
import { readTable, SHEETS } from './content.ts'
import { demoSheets } from './demo.ts'
import { DEMO_SOCI_NOW, DEMO_SOCI_TODAY } from './demo-soci.ts'
import { memoryWorkbook } from './memory.ts'

const today = DEMO_SOCI_TODAY
const content = () => memoryWorkbook(demoSheets(DEMO_SOCI_NOW))
const row = (workbook: ReturnType<typeof memoryWorkbook>, id: string) =>
  readTable(workbook, SHEETS.deadlines).rows.find((candidate) => candidate.get('id') === id)

describe('readOfficeDeadlines', () => {
  it('le scadenze da guardare: l’adempimento in ritardo in cima, poi le prossime; i bandi scaduti e le fatte no', () => {
    const { deadlines, warnings } = readOfficeDeadlines(content(), romeDate, today)
    expect(warnings).toEqual([])
    expect(deadlines.map((deadline) => [deadline.id, deadline.lateByDays, deadline.daysLeft])).toEqual([
      ['SCA-0001', 5, -5],
      ['SCA-0008', null, 6],
      ['SCA-0002', null, 12],
      ['SCA-0003', null, 20],
      ['SCA-0004', null, 30],
    ])
    expect(deadlines[0]).toMatchObject({
      what: "Quota annuale all'ente di normazione",
      kind: 'duty',
      ownerRole: 'il tesoriere',
      measureObjective: null,
    })
  })

  it('un adempimento passato da 3 giorni e non fatto è «in ritardo di 3 giorni»; una misura passata non è in ritardo', () => {
    const workbook = content()
    workbook.appendRow(SHEETS.deadlines.name, [
      'SCA-0020',
      'Bilancio al Direttivo',
      'adempimento',
      '2026-11-02',
      'il tesoriere',
      '',
      '',
      'no',
    ])
    workbook.appendRow(SHEETS.deadlines.name, [
      'MIS-O9-2026-10',
      'Conta i messaggi',
      'misura',
      '2026-10-31',
      'il segretario',
      '',
      '',
      'no',
    ])
    const { deadlines } = readOfficeDeadlines(workbook, romeDate, today)
    expect(deadlines.find((deadline) => deadline.id === 'SCA-0020')).toMatchObject({
      lateByDays: 3,
      overdueByDays: null,
    })
    expect(deadlines.find((deadline) => deadline.id === 'MIS-O9-2026-10')).toMatchObject({
      lateByDays: null,
      overdueByDays: 5,
      measureObjective: 'O9',
    })
  })

  it('senza la scheda «Scadenze» non si ferma: dice il perché', () => {
    const workbook = memoryWorkbook({})
    const { deadlines, warnings } = readOfficeDeadlines(workbook, romeDate, today)
    expect(deadlines).toEqual([])
    expect(warnings).toEqual(['Manca la scheda «Scadenze».'])
  })
})

describe('markDeadlineDone', () => {
  it('scrive «fatta il» con la data di oggi', () => {
    const workbook = content()
    expect(markDeadlineDone(workbook, { id: 'SCA-0001', today, toCalendarDate: romeDate })).toEqual({ kind: 'done' })
    expect(row(workbook, 'SCA-0001')?.get('fatta il')).toBe(today)
    expect(readOfficeDeadlines(workbook, romeDate, today).deadlines.map((deadline) => deadline.id)).not.toContain(
      'SCA-0001',
    )
  })

  it('una scadenza che non c’è, o già fatta, lo dice', () => {
    const workbook = content()
    expect(markDeadlineDone(workbook, { id: 'SCA-9999', today, toCalendarDate: romeDate })).toEqual({
      kind: 'invalid',
      message: 'Non trovo la scadenza SCA-9999.',
    })
    expect(markDeadlineDone(workbook, { id: 'SCA-0006', today, toCalendarDate: romeDate })).toEqual({
      kind: 'invalid',
      message: 'La scadenza SCA-0006 è già fatta.',
    })
  })

  it('la misura del mese chiede il numero e lo scrive in «Misure», nella riga O9', () => {
    const workbook = content()
    ensureMeasureDeadline(workbook, '2026-11')
    const without = markDeadlineDone(workbook, { id: 'MIS-O9-2026-11', today, toCalendarDate: romeDate })
    expect(without).toEqual({
      kind: 'invalid',
      message: 'Scrivi quanti messaggi sono senza risposta da più di 5 giorni.',
    })
    expect(
      markDeadlineDone(workbook, { id: 'MIS-O9-2026-11', today, toCalendarDate: romeDate, measure: 'tre' }),
    ).toMatchObject({
      kind: 'invalid',
    })
    expect(markDeadlineDone(workbook, { id: 'MIS-O9-2026-11', today, toCalendarDate: romeDate, measure: '3' })).toEqual(
      {
        kind: 'done',
      },
    )
    expect(row(workbook, 'MIS-O9-2026-11')?.get('fatta il')).toBe(today)
    const measures = readTable(workbook, SHEETS.measures)
    const o9 = measures.rows.find((candidate) => String(candidate.get('obiettivo')).startsWith('O9'))
    // La prima volta è il «prima»; dalla seconda il «dopo».
    expect([o9?.get('prima'), o9?.get('dopo')]).toEqual([3, ''])
    writeMeasure(workbook, 'O9', 1)
    const again = readTable(workbook, SHEETS.measures).rows.find((candidate) =>
      String(candidate.get('obiettivo')).startsWith('O9'),
    )
    expect([again?.get('prima'), again?.get('dopo')]).toEqual([3, 1])
  })

  it('una misura scritta a mano, senza obiettivo nell’id, si segna fatta senza numero', () => {
    const workbook = content()
    expect(measureObjective('SCA-0008')).toBeNull()
    expect(markDeadlineDone(workbook, { id: 'SCA-0008', today, toCalendarDate: romeDate })).toEqual({ kind: 'done' })
  })
})

describe('ensureMeasureDeadline', () => {
  it('crea la scadenza «misura» del mese, del segretario, non visibile ai soci, una volta sola', () => {
    const workbook = content()
    expect(measureDeadlineId('2026-11')).toBe('MIS-O9-2026-11')
    expect(ensureMeasureDeadline(workbook, '2026-11')).toBe(true)
    expect(ensureMeasureDeadline(workbook, '2026-11')).toBe(false)
    const created = row(workbook, 'MIS-O9-2026-11')
    expect(created?.get('cosa')).toBe(MEASURE_DEADLINE.what)
    expect(MEASURE_DEADLINE.what).toBe('Conta i messaggi senza risposta da più di 5 giorni (mail e Instagram)')
    expect(created?.get('tipo')).toBe('misura')
    expect(created?.get('data')).toBe('2026-11-30')
    expect(created?.get('chi segue (ruolo)')).toBe('il segretario')
    expect(created?.get('visibile ai soci')).toBe('no')
    expect(ensureMeasureDeadline(workbook, '2027-02')).toBe(true)
    expect(row(workbook, 'MIS-O9-2027-02')?.get('data')).toBe('2027-02-28')
    // Entra nella pagina della segreteria come misura: non va in rosso.
    const { deadlines } = readOfficeDeadlines(workbook, romeDate, today)
    expect(deadlines.find((deadline) => deadline.id === 'MIS-O9-2026-11')).toMatchObject({
      kind: 'measure',
      measureObjective: 'O9',
      lateByDays: null,
    })
  })
})
