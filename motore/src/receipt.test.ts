import { describe, expect, it } from 'vitest'
import { receiptMail } from './receipt.ts'

const transfer = {
  firstName: 'Rossana',
  email: 'rossana@example.org',
  payment: {
    id: 'P-2026-0042',
    amount: 30,
    validYear: 2027,
    date: '2026-10-16',
    method: 'transfer',
    reference: '8841',
  },
  cashReceipt: true,
  inGoodStanding: true,
} as const

describe('receiptMail', () => {
  it('per un bonifico dice importo, anno, data, riferimento e numero del pagamento', () => {
    expect(receiptMail(transfer)).toEqual({
      to: 'rossana@example.org',
      name: 'Segreteria RAMI',
      replyTo: 'segreteria@retemicrofarm.it',
      subject: 'Quota ricevuta, sei in regola',
      body:
        'Ciao Rossana,\n\nabbiamo ricevuto la tua quota di 30 € per il 2027: bonifico del 16/10/2026, rif. 8841.\n' +
        'Numero del pagamento: P-2026-0042.\n\nGrazie,\nla segreteria di RAMI\n\n' +
        'Come usiamo i tuoi dati: https://bussola.retemicrofarm.it/privacy',
    })
  })

  it('dice «sei in regola» solo se il socio lo è dopo il pagamento', () => {
    expect(receiptMail({ ...transfer, inGoodStanding: false })).toMatchObject({
      subject: 'Quota ricevuta',
      body: receiptMail(transfer).body,
    })
  })

  it('per i contanti niente riferimento, e la mail vale come ricevuta se le impostazioni dicono sì', () => {
    const cash = { ...transfer, payment: { ...transfer.payment, method: 'cash', reference: '', amount: 30.5 } } as const
    expect(receiptMail(cash).body).toBe(
      'Ciao Rossana,\n\nabbiamo ricevuto la tua quota di 30,50 € per il 2027: contanti del 16/10/2026.\n' +
        'Numero del pagamento: P-2026-0042.\nQuesta mail vale come ricevuta.\n\nGrazie,\nla segreteria di RAMI\n\n' +
        'Come usiamo i tuoi dati: https://bussola.retemicrofarm.it/privacy',
    )
    expect(receiptMail({ ...cash, cashReceipt: false }).body).not.toContain('ricevuta.')
  })
})
