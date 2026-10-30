import { saltKey, usageKey } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { readTable, SHEETS } from './content.ts'
import { HEALTH } from './cycle.ts'
import { demoSheets } from './demo.ts'
import { memoryKv, memoryState, memoryWorkbook } from './memory.ts'
import { closeUsageMonth } from './usage.ts'

const fingerprint = (n: number) => n.toString(16).padStart(64, '0')

function setup() {
  const kv = memoryKv()
  const state = memoryState()
  const workbook = memoryWorkbook(demoSheets(new Date('2026-10-20T10:00:00Z')))
  // Ottobre: tre persone del Coordinamento, una dei soci; il sale di ottobre e quello di novembre, già pronto.
  for (const n of [1, 2, 3]) kv.values.set(usageKey('2026-10', 'coordinamento', fingerprint(n)), '1')
  kv.values.set(usageKey('2026-10', 'soci', fingerprint(9)), '1')
  kv.values.set(saltKey('2026-10'), 'sale di ottobre')
  kv.values.set(saltKey('2026-11'), 'sale di novembre')
  // Novembre è già cominciato: una persona è entrata alle 00:20.
  kv.values.set(usageKey('2026-11', 'coordinamento', fingerprint(1)), '1')
  const close = (today: string) =>
    closeUsageMonth({ kv, scope: 'ns456', workbook, state, today, randomSalt: () => 'sale nuovo' })
  const usage = () => readTable(workbook, SHEETS.usage).rows.map((row) => SHEETS.usage.columns.map((c) => row.get(c)))
  return { kv, state, workbook, close, usage }
}

describe('il primo del mese', () => {
  it('«Uso» ha il conteggio per area del mese prima, con quante persone potevano entrare', () => {
    const { close, usage } = setup()
    close('2026-11-01')
    // Persone della Riservata con Direttivo o rappresentante fra i ruoli: Direttivo, i due rappresentanti, chi cura
    // la Bussola (anche Direttivo). La segreteria no.
    expect(usage()).toEqual([
      ['2026-10', 'coordinamento', 3, 4],
      ['2026-10', 'soci', 1, ''],
    ])
  })

  it('le impronte e il sale del mese prima spariscono; quelle del mese nuovo restano', () => {
    const { kv, close } = setup()
    close('2026-11-01')
    expect([...kv.values.keys()].sort()).toEqual([
      saltKey('2026-11'),
      saltKey('2026-12'),
      usageKey('2026-11', 'coordinamento', fingerprint(1)),
    ])
  })

  it('prepara il sale del mese dopo, che scade da solo', () => {
    const { kv, close } = setup()
    close('2026-11-01')
    expect(kv.values.get(saltKey('2026-12'))).toBe('sale nuovo')
    expect(kv.ttls.get(saltKey('2026-12'))).toBe(70 * 86_400)
    // Il sale di novembre, già pronto, non cambia: le impronte di novembre restano le stesse.
    expect(kv.values.get(saltKey('2026-11'))).toBe('sale di novembre')
  })

  it('le altre notti del mese non fa niente', () => {
    const { kv, close, usage } = setup()
    close('2026-11-01')
    const writes = kv.writes.length
    kv.values.set(usageKey('2026-10', 'coordinamento', fingerprint(7)), '1')
    const report = close('2026-11-02')
    expect(kv.writes).toHaveLength(writes)
    expect(usage()).toHaveLength(2)
    expect(report.health).toMatchObject({ piece: HEALTH.usage, status: 'a posto' })
  })

  it('un mese senza nessuno, ma col sale, si scrive a zero', () => {
    const { kv, close, usage } = setup()
    for (const key of [...kv.values.keys()]) if (key.startsWith('uso:2026-10')) kv.values.delete(key)
    close('2026-11-01')
    expect(usage()).toEqual([['2026-10', 'coordinamento', 0, 4]])
  })

  it('se Cloudflare non risponde non segna il mese come chiuso, e la notte dopo riprova senza doppioni', () => {
    const { kv, close, usage, state } = setup()
    kv.down = true
    const report = close('2026-11-01')
    expect(report.health).toMatchObject({ status: 'da guardare' })
    expect(state.values.get('uso:ns456:mese')).toBeUndefined()
    kv.down = false
    close('2026-11-02')
    close('2026-11-02')
    expect(usage()).toEqual([
      ['2026-10', 'coordinamento', 3, 4],
      ['2026-10', 'soci', 1, ''],
    ])
  })

  it('una riga già scritta per quel mese e quell’area non si scrive due volte', () => {
    const { workbook, close, usage } = setup()
    workbook.appendRow(SHEETS.usage.name, ['2026-10', 'coordinamento', 3, 4])
    close('2026-11-01')
    expect(usage()).toEqual([
      ['2026-10', 'coordinamento', 3, 4],
      ['2026-10', 'soci', 1, ''],
    ])
  })

  it('senza la scheda «Uso» non cancella niente, e lo dice', () => {
    const { kv, workbook, close } = setup()
    delete workbook.sheets[SHEETS.usage.name]
    const report = close('2026-11-01')
    expect(report.health).toMatchObject({ status: 'da guardare' })
    expect(report.health.note).toContain('Manca la scheda «Uso»')
    expect(kv.values.has(saltKey('2026-10'))).toBe(true)
  })
})
