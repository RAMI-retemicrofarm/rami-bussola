// Il motore vero dietro la pagina della segreteria: le funzioni di office.ts su un Foglio soci inventato
// (demo-soci.ts), nuovo per ogni prova, con l'account scelto dalla prova e l'ora ferma al 5/11/2026 alle 10 di Roma.
// Le mail restano in un array; il Foglio si legge dopo, riga per riga. Nessun dato vero di soci.
import { romeDate } from '@bussola/condiviso'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'
import { DEMO_SHARED_ACCOUNT, demoSociSheets } from '../../motore/src/demo-soci.ts'
import { SOCI_SHEETS } from '../../motore/src/members.ts'
import { memoryState, memoryWorkbook } from '../../motore/src/memory.ts'
import {
  cancelPayment,
  changePaymentYear,
  openOffice,
  previewPayment,
  recordPayment,
  type OfficeDeps,
} from '../../motore/src/office.ts'
import type { CancelInput, ChangeYearInput, OfficeCall, PaymentInput } from '../../motore/src/office-api.ts'
import type { Mail } from '../../motore/src/receipt.ts'
import { SHARING_STATE_KEY, type SharingReport } from '../../motore/src/sharing.ts'
import type { Rispondi } from './segreteria-finta.ts'

export const ADESSO = new Date('2026-11-05T10:00:00+01:00')

/** Gli account delle prove: in «Accessi» il segretario ha il suo, part-time e tesoriere ne condividono uno. */
export const ACCOUNT = {
  segretario: DEMO_EMAILS.office,
  condiviso: DEMO_SHARED_ACCOUNT,
  /** La riga di «Accessi» con «entra nell'area» no. */
  senzaEntrata: 'dario.conti@example.org',
  sconosciuto: 'curioso@example.org',
} as const

const ROMA = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** «dd/MM/yyyy HH:mm» nel fuso di Roma, come `Utilities.formatDate` in google.ts. */
export function formatInstant(instant: Date): string {
  const parts = ROMA.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`
}

type Scheda = { name: string; columns: readonly string[] }

export function motoreVero(
  opzioni: { email?: string; sheets?: Record<string, unknown[][]>; condivisioni?: SharingReport } = {},
) {
  const sheets = opzioni.sheets ?? demoSociSheets()
  const mails: Mail[] = []
  const state = memoryState()
  if (opzioni.condivisioni) state.set(SHARING_STATE_KEY, JSON.stringify(opzioni.condivisioni))
  const deps: OfficeDeps = {
    workbook: memoryWorkbook(sheets),
    email: opzioni.email ?? ACCOUNT.segretario,
    now: ADESSO,
    toCalendarDate: romeDate,
    formatInstant,
    withLock: (run) => run(),
    sendMail: (mail) => void mails.push(mail),
    state,
  }
  /** La prossima chiamata con quel nome lancia, prima o dopo che il motore ha lavorato (la risposta si perde). */
  const guasti = new Map<OfficeCall, 'prima' | 'dopo'>()
  /** La prossima chiamata con quel nome aspetta che la prova la lasci andare. */
  const fermi = new Map<OfficeCall, Promise<void>>()

  const chiama = (nome: OfficeCall, argomento: unknown) => {
    switch (nome) {
      case 'officeOpen':
        return openOffice(deps, argomento)
      case 'officePreview':
        return previewPayment(deps, argomento as PaymentInput)
      case 'officeRecordPayment':
        return recordPayment(deps, argomento as PaymentInput)
      case 'officeCancelPayment':
        return cancelPayment(deps, argomento as CancelInput)
      case 'officeChangeYear':
        return changePaymentYear(deps, argomento as ChangeYearInput)
    }
  }
  const rispondi: Rispondi = async (nome, argomento) => {
    const fermo = fermi.get(nome)
    if (fermo) {
      fermi.delete(nome)
      await fermo
    }
    const guasto = guasti.get(nome)
    guasti.delete(nome)
    if (guasto === 'prima') throw new Error('Service invoked too many times for one day')
    const risposta = chiama(nome, argomento)
    if (guasto === 'dopo') throw new Error('Exceeded maximum execution time')
    return risposta
  }

  /** Le righe di una scheda, come oggetti con i nomi delle colonne. */
  const righe = (scheda: Scheda) => {
    const [, ...rows] = sheets[scheda.name] ?? []
    return rows.map((row) => Object.fromEntries(scheda.columns.map((column, i) => [column, row[i] ?? ''])))
  }

  return {
    rispondi,
    sheets,
    mails,
    guasta: (nome: OfficeCall, quando: 'prima' | 'dopo' = 'prima') => void guasti.set(nome, quando),
    ferma: (nome: OfficeCall) => {
      let lascia = () => {}
      fermi.set(nome, new Promise<void>((resolve) => (lascia = resolve)))
      return () => lascia()
    },
    pagamenti: () => righe(SOCI_SHEETS.payments),
    pagamento: (id: string) => righe(SOCI_SHEETS.payments).find((row) => row.id === id),
  }
}

export type MotoreVero = ReturnType<typeof motoreVero>

/** Una data del Foglio come «AAAA-MM-GG», che il motore l'abbia scritta come Date o come testo. */
export const giorno = (value: unknown) => (value instanceof Date ? romeDate(value) : String(value))

/** Il Foglio inventato con altri soci in coda, senza pagamenti, fino a `quanti`. */
export function sociInventati(quanti: number) {
  const sheets = demoSociSheets()
  const soci = sheets[SOCI_SHEETS.members.name] ?? []
  const columns = SOCI_SHEETS.members.columns
  for (let numero = soci.length; numero <= quanti; numero++) {
    const values: Record<string, unknown> = {
      numero,
      cognome: `Cognome${numero}`,
      nome: 'Socio',
      mail: `socio${numero}@example.org`,
      tipo: 'sostenitore',
      'ammesso il': '2021-01-10',
    }
    soci.push(columns.map((column) => values[column] ?? ''))
  }
  return sheets
}
