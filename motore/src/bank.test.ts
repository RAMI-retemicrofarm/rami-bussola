import { describe, expect, it } from 'vitest'
import { parseBankText, readBankAmount, readBankDate } from './bank.ts'

describe('parseBankText', () => {
  it('legge il CSV della banca con l’intestazione, le virgolette e gli importi all’italiana', () => {
    const text = [
      'Data contabile;Data valuta;Importo;Causale;Riferimento',
      '02/11/2026;02/11/2026;"30,00";"Bonifico da ROSSI MARIO - Quota RAMI 2026 socio n. 2";TRN 8842',
      '03/11/2026;03/11/2026;"1.230,50";Bonifico sconosciuto;',
      '04/11/2026;04/11/2026;"-12,00";Canone;',
    ].join('\r\n')
    expect(parseBankText(text)).toEqual([
      {
        date: '2026-11-02',
        amount: 30,
        reason: 'Bonifico da ROSSI MARIO - Quota RAMI 2026 socio n. 2',
        reference: 'TRN 8842',
      },
      { date: '2026-11-03', amount: 1230.5, reason: 'Bonifico sconosciuto', reference: '' },
      { date: '2026-11-04', amount: -12, reason: 'Canone', reference: '' },
    ])
  })

  it('legge le righe incollate da un foglio, col tab e senza intestazione, nell’ordine della scheda', () => {
    const text = '02/11/2026\t30\tQuota socio n. 2\t8842\n\n03/11/2026\t60\tQuota due soci\t'
    expect(parseBankText(text)).toEqual([
      { date: '2026-11-02', amount: 30, reason: 'Quota socio n. 2', reference: '8842' },
      { date: '2026-11-03', amount: 60, reason: 'Quota due soci', reference: '' },
    ])
  })

  it('con «Entrate» e «Uscite» l’importo viene dalla colonna giusta; «Descrizione» vale come causale', () => {
    const text = ['Data,Descrizione,Entrate,Uscite', '2026-11-02,Quota,30.00,', '2026-11-03,Bollo,,2.00'].join('\n')
    expect(parseBankText(text)).toEqual([
      { date: '2026-11-02', amount: 30, reason: 'Quota', reference: '' },
      { date: '2026-11-03', amount: -2, reason: 'Bollo', reference: '' },
    ])
  })

  it('una riga che non si legge resta, con la data o l’importo vuoti', () => {
    expect(parseBankText('ieri\ttrenta\tQuota\t')).toEqual([{ date: '', amount: null, reason: 'Quota', reference: '' }])
    expect(parseBankText('')).toEqual([])
  })

  it('le date e gli importi come li scrivono le banche', () => {
    expect(readBankDate('02/11/2026')).toBe('2026-11-02')
    expect(readBankDate('2.11.2026')).toBe('2026-11-02')
    expect(readBankDate('02-11-26')).toBe('2026-11-02')
    expect(readBankDate('2026-11-02')).toBe('2026-11-02')
    expect(readBankDate('31/02/2026')).toBe('')
    expect(readBankAmount('30')).toBe(30)
    expect(readBankAmount('30,50 €')).toBe(30.5)
    expect(readBankAmount('1.230,50')).toBe(1230.5)
    expect(readBankAmount('1,230.50')).toBe(1230.5)
    expect(readBankAmount('30.00')).toBe(30)
    expect(readBankAmount('-12,00')).toBe(-12)
    expect(readBankAmount('+ 30')).toBe(30)
    expect(readBankAmount('EUR 30')).toBe(30)
    expect(readBankAmount('trenta')).toBeNull()
    expect(readBankAmount('')).toBeNull()
  })
})
