import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { readTable, SHEETS } from './content.ts'
import { demoSheets } from './demo.ts'
import { DEMO_SOCI_NOW, demoSociSheets } from './demo-soci.ts'
import { memoryState, memoryWorkbook } from './memory.ts'
import { MONTHLY_STATE_KEY, runMonthly } from './monthly.ts'
import { readRegisterState, type RegisterStore } from './register.ts'

function setup(fails = false) {
  const saved: string[] = []
  const store: RegisterStore = {
    save(name) {
      if (fails) throw new Error('Drive non risponde')
      saved.push(name)
      return `https://docs.google.com/spreadsheets/d/${saved.length}/edit`
    },
  }
  const content = memoryWorkbook(demoSheets(DEMO_SOCI_NOW))
  const state = memoryState()
  const deps = (today: string) => ({
    content,
    soci: memoryWorkbook(demoSociSheets()),
    state,
    today,
    toCalendarDate: romeDate,
    store,
  })
  const ids = () => readTable(content, SHEETS.deadlines).rows.map((row) => String(row.get('id')))
  return { deps, saved, state, ids }
}

describe('runMonthly', () => {
  it('il primo del mese crea la scadenza «misura» del mese e salva il libro soci nel Drive, una volta sola', () => {
    const { deps, saved, state, ids } = setup()
    const first = runMonthly(deps('2026-12-01'))
    expect(first.ran).toBe(true)
    expect(first.lines).toEqual([
      'Scadenza «misura» di 2026-12 creata: MIS-O9-2026-12.',
      'Libro soci salvato nel Drive: «Libro soci al 2026-12-01».',
    ])
    expect(ids()).toContain('MIS-O9-2026-12')
    expect(saved).toEqual(['Libro soci al 2026-12-01'])
    expect(state.get(MONTHLY_STATE_KEY)).toBe('2026-12')
    // Le altre notti del mese non fa niente.
    expect(runMonthly(deps('2026-12-02'))).toEqual({ ran: false, lines: [] })
    expect(saved).toHaveLength(1)
    expect(ids().filter((id) => id === 'MIS-O9-2026-12')).toHaveLength(1)
  })

  it('se la copia non riesce, «Oggi» lo sa e la notte dopo ci riprova; la scadenza non si raddoppia', () => {
    const failing = setup(true)
    const first = runMonthly(failing.deps('2026-12-01'))
    expect(first.ran).toBe(true)
    expect(first.lines[1]).toBe('Libro soci non salvato: Drive non risponde. Ci riprovo domani notte.')
    expect(readRegisterState(failing.state)).toMatchObject({ failedOn: '2026-12-01', error: 'Drive non risponde' })
    expect(failing.state.get(MONTHLY_STATE_KEY)).toBeNull()
    const again = runMonthly(failing.deps('2026-12-02'))
    expect(again.ran).toBe(true)
    expect(again.lines).toEqual(['Libro soci non salvato: Drive non risponde. Ci riprovo domani notte.'])
    expect(failing.ids().filter((id) => id === 'MIS-O9-2026-12')).toHaveLength(1)
  })

  it('un mese saltato si recupera la prima notte utile', () => {
    const { deps, saved, state } = setup()
    runMonthly(deps('2026-12-15'))
    expect(saved).toEqual(['Libro soci al 2026-12-15'])
    expect(state.get(MONTHLY_STATE_KEY)).toBe('2026-12')
  })
})
