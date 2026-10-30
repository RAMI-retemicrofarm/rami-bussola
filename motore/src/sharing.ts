// Il controllo delle condivisioni, ogni giorno (cartamodello, «Il controllo automatico»): il Foglio soci e la cartella
// «Bussola» contro l'elenco di chi legge il Foglio soci; la cartella «Libro soci» contro lo stesso elenco più il
// Direttivo. Ciò che è fuori dall'elenco va in «Oggi» del segretario, con l'account. Drive entra già letto (google.ts).
// L'indirizzo della segreteria è nell'elenco anche se non è in «Accessi»: la cartella «Bussola» sta nel Drive di RAMI,
// mentre il motore gira con l'account della Bussola (ADR 0004).
import { normalizeEmail, type CalendarDate } from '@bussola/condiviso'
import { readPeople, readTable, SHEETS, type Workbook } from './content.ts'
import { OFFICE_ADDRESS, readAccess, readOfficeSettings, SOCI_SHEETS } from './members.ts'
import type { SharingFinding } from './office-api.ts'
import type { PublishState } from './publish.ts'

export const SHARING_PLACES = {
  sociSheet: 'il Foglio soci',
  bussolaFolder: 'la cartella «Bussola»',
  libroFolder: 'la cartella «Libro soci»',
} as const

/** Un file o una cartella del Drive come lo dà DriveApp: `access` e `permission` sono i nomi degli enum di Google. */
export type SharedItem = {
  where: string
  editors: string[]
  viewers: string[]
  /** PRIVATE, DOMAIN, DOMAIN_WITH_LINK, ANYONE, ANYONE_WITH_LINK. */
  access: string
  /** EDIT, COMMENT, VIEW… */
  permission: string
}

export function sharingFindings(item: SharedItem, allowed: ReadonlySet<string>): SharingFinding[] {
  const findings: SharingFinding[] = []
  const outside = (emails: string[], access: SharingFinding['access']) => {
    for (const email of emails) {
      const account = normalizeEmail(email)
      if (account && !allowed.has(account)) findings.push({ where: item.where, account, access })
    }
  }
  outside(item.editors, 'modifica')
  outside(item.viewers, 'lettura')
  if (item.access !== 'PRIVATE')
    findings.push({
      where: item.where,
      account: item.access.startsWith('ANYONE') ? 'chiunque abbia il link' : 'chi è nel dominio',
      access: item.permission === 'EDIT' ? 'modifica' : 'lettura',
    })
  return findings
}

export type SharingReport = { checkedOn: CalendarDate | ''; findings: SharingFinding[] }

export const SHARING_STATE_KEY = 'segreteria:condivisioni'

export type SharingCheckDeps = {
  soci: Workbook
  /** Il Foglio contenuti, per il Direttivo: si apre solo se c'è la cartella «Libro soci». */
  content: () => Workbook
  /** L'account dello script, quello della Bussola: il proprietario del Foglio soci. */
  owner: string
  sociSheet: SharedItem
  bussolaFolder: SharedItem
  /** Null se la proprietà LIBRO_SOCI_FOLDER_ID non c'è ancora. */
  libroFolder: SharedItem | null
  state: PublishState
  today: CalendarDate
}

export function runSharingCheck(deps: SharingCheckDeps): SharingReport {
  const access = readAccess(readTable(deps.soci, SOCI_SHEETS.access))
  // Le voci fisse non hanno date: il fuso non conta.
  const settings = readOfficeSettings(readTable(deps.soci, SOCI_SHEETS.settings), () => '')
  const readers = new Set([
    normalizeEmail(deps.owner),
    OFFICE_ADDRESS,
    ...access.filter((row) => row.enters && row.email).map((row) => row.email),
    ...settings.readers,
  ])
  const findings = [...sharingFindings(deps.sociSheet, readers), ...sharingFindings(deps.bussolaFolder, readers)]
  if (deps.libroFolder) {
    const people = readPeople(readTable(deps.content(), SHEETS.people), [])
    const board = people
      .filter((person) => person.roles.includes('board'))
      .map((person) => normalizeEmail(person.email))
    findings.push(...sharingFindings(deps.libroFolder, new Set([...readers, ...board])))
  }
  const report: SharingReport = { checkedOn: deps.today, findings }
  deps.state.set(SHARING_STATE_KEY, JSON.stringify(report))
  return report
}

/** L'ultimo controllo salvato; vuoto se non è ancora girato. */
export function readSharingReport(state: Pick<PublishState, 'get'>): SharingReport {
  const saved = state.get(SHARING_STATE_KEY)
  return saved ? (JSON.parse(saved) as SharingReport) : { checkedOn: '', findings: [] }
}
