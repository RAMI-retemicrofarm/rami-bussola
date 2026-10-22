// La mail «Quota ricevuta, sei in regola» (flusso D, punto 3): parte al socio quando un pagamento è registrato e
// conta. Se il socio non è in regola nemmeno dopo, l'oggetto è solo «Quota ricevuta». Un pagamento in attesa del tesoriere la manda alla conferma (T4).
import type { CalendarDate } from '@bussola/condiviso'
import { PRIVACY_URL } from './form.ts'
import type { OfficePayment } from './office-api.ts'

export type Mail = { to: string; name: string; subject: string; body: string }

export type ReceiptInput = {
  firstName: string
  email: string
  payment: Pick<OfficePayment, 'id' | 'amount' | 'validYear' | 'method' | 'reference'> & { date: CalendarDate | '' }
  /** «per i contanti, la mail fa da ricevuta». */
  cashReceipt: boolean
  /** Il socio è in regola dopo questo pagamento: una quota di un anno passato, o di un receduto, non lo mette. */
  inGoodStanding: boolean
}

/** 30 → «30», 30,5 → «30,50». */
export const euro = (amount: number): string =>
  Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',')

/** «2026-10-16» → «16/10/2026». */
export const italianDate = (date: CalendarDate | ''): string => date.split('-').reverse().join('/')

export function receiptMail({ firstName, email, payment, cashReceipt, inGoodStanding }: ReceiptInput): Mail {
  const how =
    payment.method === 'cash'
      ? `contanti del ${italianDate(payment.date)}`
      : `bonifico del ${italianDate(payment.date)}, rif. ${payment.reference}`
  const lines = [
    `Ciao ${firstName},`,
    '',
    `abbiamo ricevuto la tua quota di ${euro(payment.amount)} € per il ${payment.validYear}: ${how}.`,
    `Numero del pagamento: ${payment.id}.`,
  ]
  if (payment.method === 'cash' && cashReceipt) lines.push('Questa mail vale come ricevuta.')
  lines.push('', 'Grazie,', 'la segreteria di RAMI', '', `Come usiamo i tuoi dati: ${PRIVACY_URL}`)
  const subject = inGoodStanding ? 'Quota ricevuta, sei in regola' : 'Quota ricevuta'
  return { to: email, name: 'Segreteria RAMI', subject, body: lines.join('\n') }
}
