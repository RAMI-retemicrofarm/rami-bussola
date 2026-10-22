// La migrazione dentro il Foglio soci: legge la copia del libro soci di oggi e i pagamenti in dubbio, incollati in
// due schede, e scrive «Soci» e «Pagamenti» con `migrateRegister`. In prova dà solo il resoconto; per davvero scrive
// solo in schede vuote o già scritte in parte da questa migrazione, così un rilancio riprende e non raddoppia nessuno.
import type { CalendarDate } from '@bussola/condiviso'
import { readTable, rowValues, text, type ToCalendarDate, type Workbook } from './content.ts'
import { memberCell, readOfficeSettings, SOCI_SHEETS } from './members.ts'
import { migrateRegister } from './migration.ts'

/** Le schede dove chi cura la Bussola incolla il libro di oggi e l'elenco del tesoriere. */
export const MIGRATION_SHEETS = {
  register: 'Libro soci di oggi',
  doubtful: 'Pagamenti in dubbio',
  /** Il resoconto dell'ultimo lancio, che si legge col segretario. */
  report: 'Migrazione',
} as const

export function runMigration(
  workbook: Workbook,
  options: { today: CalendarDate; toCalendarDate: ToCalendarDate; write: boolean },
): string[] {
  const register = workbook.values(MIGRATION_SHEETS.register)
  if (!register)
    return [
      `Manca la scheda «${MIGRATION_SHEETS.register}»: incollaci la copia del libro soci di oggi, con l'intestazione ` +
        'nella prima riga.',
    ]
  const settings = readOfficeSettings(readTable(workbook, SOCI_SHEETS.settings), options.toCalendarDate).dues
  const result = migrateRegister({
    register,
    doubtful: workbook.values(MIGRATION_SHEETS.doubtful),
    today: options.today,
    settings,
    toCalendarDate: options.toCalendarDate,
  })
  if (!result.ok) return result.report
  if (!options.write)
    return [...result.report, 'Prova: non ho scritto niente. Per scrivere, lancia migrateMemberRegister.']

  // Un lancio fermato a metà (tempo massimo di Apps Script, un errore) lascia Soci e Pagamenti in parte scritti: il
  // rilancio riprende se ogni riga che c'è viene da questa migrazione, e rifiuta se ce n'è anche una sola d'altro.
  const memberKeys = result.members.map((member) => member.numero ?? '')
  const paymentKeys = result.payments.map((payment) => String(payment.id))
  const present: { members: Set<string>; payments: Set<string> } = { members: new Set(), payments: new Set() }
  for (const [spec, key, ours, found] of [
    [SOCI_SHEETS.members, 'numero', memberKeys, present.members],
    [SOCI_SHEETS.payments, 'id', paymentKeys, present.payments],
  ] as const) {
    const filled = readTable(workbook, spec).rows
    for (const row of filled) found.add(text(row.get(key)))
    if (filled.some((row) => ours.indexOf(text(row.get(key))) < 0) || found.size < filled.length)
      return [
        ...result.report,
        `Non ho scritto niente: in «${spec.name}» ci sono già righe (${filled.length}). La migrazione scrive solo in ` +
          '«Soci» e «Pagamenti» vuoti.',
      ]
  }
  const missingMembers = result.members.filter((member) => !present.members.has(member.numero ?? ''))
  const missingPayments = result.payments.filter((payment) => !present.payments.has(String(payment.id)))
  if (!missingMembers.length && !missingPayments.length)
    return [...result.report, 'La migrazione è già completa: non ho scritto niente.']
  const resumed = present.members.size + present.payments.size > 0
  const lines = [...result.report]
  if (resumed)
    lines.push(
      `Ripresa: c'erano già ${present.members.size} soci e ${present.payments.size} pagamenti di questa migrazione; ` +
        'ho scritto il resto.',
    )

  let members = 0
  let payments = 0
  try {
    // Le colonne del libro che non si riconoscono vanno in fondo a «Soci», col loro nome: possono servire alla legge.
    // Al rilancio ci sono già, e non si aggiungono una seconda volta.
    const before = readTable(workbook, SOCI_SHEETS.members)
    let last = Math.max(-1, ...before.header.values())
    for (const column of result.extraColumns)
      if (!before.header.has(column.trim().toLowerCase())) workbook.setCell(SOCI_SHEETS.members.name, 0, ++last, column)

    const membersTable = readTable(workbook, SOCI_SHEETS.members)
    for (const member of missingMembers) {
      workbook.appendRow(
        SOCI_SHEETS.members.name,
        rowValues(membersTable, { ...member, numero: memberCell(member.numero ?? '') }),
      )
      members++
    }
    const paymentsTable = readTable(workbook, SOCI_SHEETS.payments)
    for (const payment of missingPayments) {
      workbook.appendRow(
        SOCI_SHEETS.payments.name,
        rowValues(paymentsTable, { ...payment, 'numero socio': memberCell(String(payment['numero socio'] ?? '')) }),
      )
      payments++
    }
  } catch (error) {
    // Niente eccezione: il resoconto deve arrivare comunque nella scheda «Migrazione», con dove si è fermato.
    const message = (error instanceof Error ? error.message : String(error)).trim().replace(/\.$/, '')
    return [
      ...lines,
      `Mi sono fermato dopo ${present.members.size + members} soci e ${present.payments.size + payments} pagamenti: ` +
        `${message}. Rilancia migrateMemberRegister: riparte da dove si è fermato.`,
    ]
  }
  return [...lines, `Soci scritti in «Soci»: ${members}. Pagamenti scritti in «Pagamenti»: ${payments}.`]
}
