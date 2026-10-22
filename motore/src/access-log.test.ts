import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { logAccessEdit, recentAccessChanges, type AccessEdit } from './access-log.ts'
import { readTable } from './content.ts'
import { SOCI_SHEETS } from './members.ts'
import { memoryWorkbook } from './memory.ts'

const when = new Date('2026-11-05T09:30:00Z')
const sheets = () => ({
  Accessi: [[...SOCI_SHEETS.access.columns]],
  'Registro di Accessi': [[...SOCI_SHEETS.accessLog.columns]],
})
const edit = (change: Partial<AccessEdit>): AccessEdit => ({
  sheet: 'Accessi',
  cells: 'D3',
  singleCell: true,
  oldValue: 'no',
  value: 'sì',
  shown: [['sì']],
  user: 'segreteria@example.org',
  when,
  ...change,
})

describe('logAccessEdit', () => {
  it('una cella di «Accessi»: quando, chi, quale cella, prima e dopo', () => {
    const workbook = memoryWorkbook(sheets())
    expect(logAccessEdit(workbook, edit({}))).toBe(true)
    expect(workbook.sheets['Registro di Accessi']?.[1]).toEqual([when, 'segreteria@example.org', 'D3', 'no', 'sì'])
  })

  it('chi non si sa è «non noto»; una cella vuota prima o cancellata resta vuota', () => {
    const workbook = memoryWorkbook(sheets())
    logAccessEdit(workbook, edit({ user: '', oldValue: undefined, value: 'sì' }))
    logAccessEdit(workbook, edit({ oldValue: 'sì', value: undefined, shown: [['']] }))
    expect(workbook.sheets['Registro di Accessi']?.slice(1)).toEqual([
      [when, 'non noto', 'D3', '', 'sì'],
      [when, 'segreteria@example.org', 'D3', 'sì', ''],
    ])
  })

  it('più celle: niente valore prima, e dopo i valori mostrati uniti con « · »', () => {
    const workbook = memoryWorkbook(sheets())
    logAccessEdit(
      workbook,
      edit({
        cells: 'A4:C4',
        singleCell: false,
        oldValue: undefined,
        value: undefined,
        shown: [['Ugo', 'u@x.org', '']],
      }),
    )
    logAccessEdit(workbook, edit({ cells: 'A5:B5', singleCell: false, shown: [['', '']] }))
    expect(workbook.sheets['Registro di Accessi']?.slice(1)).toEqual([
      [when, 'segreteria@example.org', 'A4:C4', '', 'Ugo · u@x.org · '],
      [when, 'segreteria@example.org', 'A5:B5', '', ''],
    ])
  })

  it('le altre schede non si registrano', () => {
    const workbook = memoryWorkbook(sheets())
    expect(logAccessEdit(workbook, edit({ sheet: 'Soci' }))).toBe(false)
    expect(workbook.sheets['Registro di Accessi']).toHaveLength(1)
  })
})

describe('recentAccessChanges', () => {
  const day = (days: number) => new Date(when.getTime() - days * 86_400_000)
  const formatInstant = (instant: Date) => `${romeDate(instant)} ore x`

  it('i cambi degli ultimi 30 giorni, dal più recente; uno di 31 giorni fa non c’è più', () => {
    const workbook = memoryWorkbook({
      'Registro di Accessi': [
        [...SOCI_SHEETS.accessLog.columns],
        [day(31), 'a@example.org', 'B2', 'x', 'y'],
        [day(30), 'b@example.org', 'C2', '', 'sì'],
        [day(10), 'non noto', 'A3:F3', '', 'Ugo · sì'],
        [day(12), 'c@example.org', 'D2', 'sì', 'no'],
      ],
    })
    const changes = recentAccessChanges(
      readTable(workbook, SOCI_SHEETS.accessLog),
      '2026-11-05',
      romeDate,
      formatInstant,
    )
    expect(changes).toEqual([
      { when: '2026-10-26 ore x', who: 'non noto', cells: 'A3:F3', before: '', after: 'Ugo · sì' },
      { when: '2026-10-24 ore x', who: 'c@example.org', cells: 'D2', before: 'sì', after: 'no' },
      { when: '2026-10-06 ore x', who: 'b@example.org', cells: 'C2', before: '', after: 'sì' },
    ])
  })
})
