// Il libro soci nel Drive (T4): «Libro soci al AAAA-MM-GG», in sola lettura, nella cartella «Libro soci». Solo le
// colonne che la legge chiede: numero, cognome, nome, tipo, ammesso il, delibera, receduto il, e le quote che contano
// dell'anno prima, di quest'anno e dell'anno dopo. Mai mail, telefono e note. Il primo di ogni mese la copia si fa da
// sola (monthly.ts); «Salva nel Drive» la fa dalla pagina. Il Drive entra come `RegisterStore`.
import { countsTowardsDues, type CalendarDate } from '@bussola/condiviso'
import { readTable, type ToCalendarDate, type Workbook } from './content.ts'
import {
  MEMBER_TYPE_WORDS,
  memberCell,
  readMembers,
  readPayments,
  SOCI_SHEETS,
  type MemberRow,
  type PaymentRow,
} from './members.ts'
import type { PublishState } from './publish.ts'
import { euro, italianDate } from './receipt.ts'

export type RegisterStore = {
  /** Crea il file coi valori dati, in sola lettura, nella cartella «Libro soci»; restituisce il link. */
  save(name: string, rows: unknown[][]): string
}

export const REGISTER_STATE_KEY = 'segreteria:libro'

export type RegisterState = {
  /** L'ultima copia riuscita. */
  savedOn: CalendarDate | ''
  url: string
  /** L'ultimo tentativo non riuscito, se è dopo l'ultima copia; «Oggi» lo dice. */
  failedOn: CalendarDate | ''
  error: string
}

export const registerName = (today: CalendarDate) => `Libro soci al ${today}`

const FIXED_COLUMNS = ['numero', 'cognome', 'nome', 'tipo', 'ammesso il', 'delibera', 'receduto il'] as const

/** «30 € il 15/01/2026 (P-2026-0001)», oppure «dal libro soci (L-2026-0001)» per le quote senza data. */
function quotaCell(payment: PaymentRow): string {
  if (payment.method === 'register') return `dal libro soci (${payment.id})`
  return `${euro(payment.amount)} € il ${italianDate(payment.date)} (${payment.id})`
}

/** Le righe del libro, intestazione compresa, per numero socio. */
export function memberRegisterRows(
  members: readonly MemberRow[],
  payments: readonly PaymentRow[],
  today: CalendarDate,
) {
  const year = Number(today.slice(0, 4))
  const years = [year - 1, year, year + 1]
  const header: unknown[] = [...FIXED_COLUMNS, ...years.map((quotaYear) => `quota ${quotaYear}`)]
  const byNumber = (a: MemberRow, b: MemberRow) => {
    const left = Number(a.number)
    const right = Number(b.number)
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return a.number.localeCompare(b.number)
  }
  const rows = [...members].sort(byNumber).map((member) => {
    const own = payments.filter((payment) => payment.memberNumber === member.number && countsTowardsDues(payment))
    return [
      memberCell(member.number),
      member.lastName,
      member.firstName,
      member.type ? MEMBER_TYPE_WORDS[member.type] : '',
      member.admittedOn,
      member.resolution,
      member.leftOn,
      ...years.map((quotaYear) =>
        own
          .filter((payment) => payment.validYear === quotaYear)
          .map(quotaCell)
          .join('; '),
      ),
    ]
  })
  return [header, ...rows]
}

export function readRegisterState(state: Pick<PublishState, 'get'>): RegisterState {
  const empty: RegisterState = { savedOn: '', url: '', failedOn: '', error: '' }
  const saved = state.get(REGISTER_STATE_KEY)
  if (!saved) return empty
  try {
    return { ...empty, ...(JSON.parse(saved) as Partial<RegisterState>) }
  } catch {
    return empty
  }
}

export type SaveRegisterDeps = {
  workbook: Workbook
  toCalendarDate: ToCalendarDate
  today: CalendarDate
  store: RegisterStore
  state: PublishState
}

/** Salva la copia di oggi e ricorda com'è andata: se il Drive non risponde, l'errore resta finché una copia riesce. */
export function saveMemberRegister(deps: SaveRegisterDeps): RegisterState {
  const before = readRegisterState(deps.state)
  let next: RegisterState
  try {
    const members = readMembers(readTable(deps.workbook, SOCI_SHEETS.members), deps.toCalendarDate)
    const payments = readPayments(readTable(deps.workbook, SOCI_SHEETS.payments), deps.toCalendarDate)
    const url = deps.store.save(registerName(deps.today), memberRegisterRows(members, payments, deps.today))
    next = { savedOn: deps.today, url, failedOn: '', error: '' }
  } catch (error) {
    next = { ...before, failedOn: deps.today, error: error instanceof Error ? error.message : String(error) }
  }
  deps.state.set(REGISTER_STATE_KEY, JSON.stringify(next))
  return next
}
