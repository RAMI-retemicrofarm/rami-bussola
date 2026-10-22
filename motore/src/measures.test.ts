import { describe, expect, it } from 'vitest'
import { MEASURES } from './measures.ts'

describe('le Misure', () => {
  it('hanno dieci righe, da O1 a O10, in ordine', () => {
    expect(MEASURES.map((measure) => measure.objective.split(' · ')[0])).toEqual([
      'O1',
      'O2',
      'O3',
      'O4',
      'O5',
      'O6',
      'O7',
      'O8',
      'O9',
      'O10',
    ])
  })

  it('in ogni riga «chi conta» nomina una persona sola', () => {
    for (const measure of MEASURES) expect(['chi cura la Bussola', 'il segretario']).toContain(measure.whoCounts)
  })

  it('O9, i messaggi senza risposta, la conta il segretario', () => {
    expect(MEASURES[8]?.whoCounts).toBe('il segretario')
    expect(MEASURES.filter((measure) => measure.whoCounts === 'il segretario')).toHaveLength(1)
  })

  it('il «prima» c’è dove è già noto: O3, O5 e O8', () => {
    expect(MEASURES.map((measure) => measure.before)).toEqual(['', '', 13.6, '', 0, '', '', 91.6, '', ''])
  })

  it('O2 si misura come variazione relativa, le altre come differenza', () => {
    expect(MEASURES.filter((measure) => measure.change === 'relative').map((measure) => measure.objective)).toEqual([
      'O2 · Meno domande ripetute nelle chat',
    ])
  })
})
