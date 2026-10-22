import { describe, expect, it } from 'vitest'
import { cellValue } from './google.ts'

// Il Foglio legge ciò che riceve come se lo scrivesse una persona: «15/11» diventa una data, «1.200» un numero.
describe('cellValue', () => {
  it('un testo che comincia con = + - @ si scrive come testo, non come formula', () => {
    expect(cellValue('=IMPORTXML("https://example.org")')).toBe('\'=IMPORTXML("https://example.org")')
    expect(cellValue('-3 iscritti')).toBe("'-3 iscritti")
  })

  it('una risposta che il Foglio leggerebbe come numero, data, ora o vero/falso resta testo', () => {
    for (const value of ['15/11', '1.200', '12:30', '3', '15/11/2026 18:30', '20 %', 'vero', 'FALSE'])
      expect(cellValue(value), value).toBe(`'${value}`)
  })

  it('le date del motore restano date, e il resto non cambia', () => {
    expect(cellValue('2026-11-20')).toBe('2026-11-20')
    expect(cellValue('Riunione il 15/11 alle 18:30')).toBe('Riunione il 15/11 alle 18:30')
    expect(cellValue('')).toBe('')
    const now = new Date()
    expect(cellValue(now)).toBe(now)
    expect(cellValue(12)).toBe(12)
  })
})
