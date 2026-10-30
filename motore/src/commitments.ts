// Gli impegni (T6), dalla scheda «Impegni» del Foglio contenuti: le parole degli stati e dei tipi, la lettura con gli
// avvisi, l'elenco delle righe «da scrivere» per il Modulo e le risposte del Modulo «Proponi un impegno», che
// completano una riga. La riga la scrive la segreteria, quando il Coordinamento dice che un impegno serve; le date di
// delibera e ratifica le scrive la segreteria, e spostano lo stato. Chi prende un impegno è un numero socio, mai un
// nome. Di chi propone il Modulo scrive anche nome, cognome e mail, che la lettura non legge: restano nel Foglio.
// Funzioni pure: il giro del motore scrive nel Foglio ciò che esce da qui.
import {
  COMMITMENT_STATUS_LABELS,
  isCalendarDate,
  isPublicStatus,
  type BudgetLine,
  type CalendarDate,
  type CommitmentOutcome,
  type CommitmentPay,
  type CommitmentStatus,
  type CommitmentTerm,
  type ReservedCommitment,
} from '@bussola/condiviso'
import {
  ContentError,
  groupResolver,
  readAmount,
  readTable,
  readYesNo,
  rowReader,
  SHEETS,
  text,
  type Table,
  type ToCalendarDate,
  type Workbook,
} from './content.ts'
import { commitmentIdIn, commitmentLabel, projectIdIn, type CommitmentAnswer, type FormResponse } from './form.ts'
import { NOT_APPLIED } from './updates.ts'

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const words = <T extends string>(entries: Record<string, T>) => ({
  read: (value: unknown): T | undefined => entries[normalize(text(value))],
  /** La prima parola di ogni valore: come si scrive nel Foglio. */
  cell: (value: T): string => Object.entries(entries).find(([, candidate]) => candidate === value)?.[0] ?? '',
  values: [...new Set(Object.keys(entries))],
})

/** Le parole dello stato, come si scrivono nella colonna «stato». «Ratificato» vale «aperto». */
export const STATUS_WORDS = words<CommitmentStatus>({
  'da scrivere': 'toWrite',
  proposto: 'proposed',
  'approvato dal coordinamento': 'approved',
  aperto: 'open',
  ratificato: 'open',
  preso: 'taken',
  'in corso': 'ongoing',
  consegnato: 'delivered',
  chiuso: 'closed',
  respinto: 'rejected',
})

export const OUTCOME_WORDS = words<CommitmentOutcome>({
  completato: 'completed',
  revocato: 'revoked',
  ritirato: 'withdrawn',
})

export const TERM_WORDS = words<CommitmentTerm>({ continuativo: 'ongoing', 'a progetto': 'project' })

export const PAY_WORDS = words<CommitmentPay>({
  volontario: 'volunteer',
  'rimborso spese': 'expenses',
  compenso: 'paid',
})

/** Le parole delle colonne a scelta, per le convalide della preparazione. */
export const COMMITMENT_CHOICES = {
  stato: [
    'da scrivere',
    'proposto',
    'approvato dal Coordinamento',
    'aperto',
    'preso',
    'in corso',
    'consegnato',
    'chiuso',
    'respinto',
  ],
  esito: OUTCOME_WORDS.values,
  tipo: TERM_WORDS.values,
  retribuzione: PAY_WORDS.values,
  'compenso visibile ai soci': ['sì', 'no'],
} as const

/**
 * Una riga della scheda, già letta: la scheda della Riservata senza i numeri del budget, la riga del Foglio e il
 * momento esatto di «proposto il» quando l'ha scritto il Modulo, per riconoscere un giro ripetuto.
 */
export type CommitmentRow = Omit<ReservedCommitment, 'planned' | 'spent'> & {
  index: number
  proposedAt: number | null
}

export type CommitmentContext = {
  toCalendarDate: ToCalendarDate
  warnings: string[]
  groups: readonly { id: string; name: string }[]
  projects: readonly { id: string; groupId: string; title: string }[]
  /** I numeri soci delle Persone della Riservata: chi verifica e chi propone stanno fra loro. */
  memberNumbers: readonly string[]
  feeVisibleDefault: boolean
  /** Per l'anno di un impegno vivo, quando non è scritto. */
  today: CalendarDate
}

/** L'id come lo scrive la segreteria, e come il Modulo e la scheda «Budget» lo ritrovano. */
const COMMITMENT_ID = /^IMP-\d+$/

/** Un impegno può essere anche per un organo di RAMI, non solo per un GdL o un cantiere. */
const ORGANS = ['direttivo', 'coordinamento', 'assemblea', 'segreteria', 'tesoreria', 'struttura', 'rami']
const isOrgan = (value: string) => ORGANS.includes(normalize(value).replace(/^(?:il|la|l['’])\s*/, ''))

/** Gli stati di un impegno che vive ancora: vale per l'anno in cui vive. */
const isAlive = (status: CommitmentStatus) => status !== 'closed' && status !== 'rejected'

/** Un numero socio: lettere, cifre e trattini, senza spazi né chiocciole. Un nome non lo è. */
const MEMBER_NUMBER = /^[\p{L}\d-]+$/u
const looksLikeNumber = (value: string) => MEMBER_NUMBER.test(value) && /\d/.test(value)

/** Una mail. Google la controlla già nel Modulo: questa è la rete per un Modulo nato prima della domanda. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * La scheda «Impegni». Lo stato vuoto vale «da scrivere». Dopo «proposto» la data della delibera porta ad «approvato
 * dal Coordinamento», e la data della ratifica ad «aperto». Uno stato dei soci senza la ratifica resta com'è nella
 * Riservata, con l'avviso: sul sito non esce (snapshots.ts). Le «note», e nome, cognome e mail di chi propone, non si
 * leggono: restano nel Foglio.
 */
export function readCommitments(table: Table, context: CommitmentContext): CommitmentRow[] {
  const groupOf = groupResolver(context.groups)
  const groupNames = context.groups.map((group) => group.name)
  const commitments: CommitmentRow[] = []
  const firstRow = new Map<string, number>()
  for (const row of table.rows) {
    const read = rowReader(table, row, context.toCalendarDate, context.warnings, groupNames)
    const id = text(row.get('id'))
    if (!id) {
      read.warn('manca l’id, l’impegno non si pubblica.')
      continue
    }
    if (!COMMITMENT_ID.test(id)) {
      read.warn(`l’id «${id}» non è nella forma IMP-0001, e dal Modulo non si sceglierebbe: l’impegno non si pubblica.`)
      continue
    }
    const first = firstRow.get(id)
    if (first !== undefined) {
      read.warn(`l’id ${id} c’è già alla riga ${first + 1}, l’impegno non si pubblica.`)
      continue
    }
    firstRow.set(id, row.index)
    const written = text(row.get('stato'))
    const stated = written ? STATUS_WORDS.read(written) : 'toWrite'
    if (!stated) {
      read.warn(`lo stato «${written}» non lo conosco, l’impegno non si pubblica.`)
      continue
    }
    const date = (column: string) => read.date(column, '') ?? null
    const proposedOn = date('proposto il')
    const coordinationOn = date('delibera del Coordinamento il')
    const ratifiedOn = date('ratifica del Direttivo il')
    let status = stated
    if (status === 'proposed' && coordinationOn) status = 'approved'
    if ((status === 'proposed' || status === 'approved') && ratifiedOn) status = 'open'
    // Un chiuso sul sito non va mai (snapshots.ts), ma senza la ratifica è comunque una riga da guardare.
    if ((isPublicStatus(status) || status === 'closed') && !ratifiedOn)
      read.warn(
        `lo stato è «${written.toLowerCase()}», ma manca «ratifica del Direttivo il»` +
          `${status === 'closed' ? '' : ': l’impegno non esce sul sito'}.`,
      )

    const outcomeText = text(row.get('esito'))
    const outcome = outcomeText ? OUTCOME_WORDS.read(outcomeText) : undefined
    if (outcomeText && !outcome) read.warn(`l’esito «${outcomeText}» non lo conosco.`)
    if (status === 'closed' && !outcome)
      read.warn('l’impegno è chiuso, ma manca l’esito: completato, revocato o ritirato.')
    const rejectionReason = text(row.get('motivo del respingimento'))
    if (status === 'rejected' && !rejectionReason)
      read.warn('l’impegno è respinto, ma manca il «motivo del respingimento».')

    const choice = <T extends string>(column: string, dictionary: { read: (value: unknown) => T | undefined }) => {
      const value = text(row.get(column))
      if (!value) return null
      const found = dictionary.read(value)
      if (!found) read.warn(`«${column}» vale «${value}»: non lo conosco.`)
      return found ?? null
    }
    const amount = (column: string) => {
      const value = readAmount(row.get(column))
      if (value === undefined) read.warn(`la cifra «${text(row.get(column))}» in «${column}» non la leggo.`)
      return value ?? null
    }
    /** Un numero socio: un nome non esce mai, nemmeno nella Riservata. */
    const number = (column: string, among?: { who: string; numbers: readonly string[] }) => {
      const value = text(row.get(column))
      if (!value) return null
      if (!looksLikeNumber(value)) {
        read.warn(`in «${column}» va il numero socio, mai il nome: non esce.`)
        return null
      }
      if (among && !among.numbers.includes(value))
        read.warn(`${among.who} (${value}) non è fra le Persone della Riservata.`)
      return value
    }
    const people = context.memberNumbers
    const visible = text(row.get('compenso visibile ai soci'))
      ? readYesNo(row.get('compenso visibile ai soci'))
      : context.feeVisibleDefault
    if (visible === undefined)
      read.warn(`«compenso visibile ai soci» vale «${text(row.get('compenso visibile ai soci'))}»: lo tratto come no.`)

    const target = text(row.get('cantiere o GdL'))
    const projectId = projectIdIn(target)
    const project = projectId ? context.projects.find((candidate) => candidate.id === projectId) : undefined
    const groupId = project ? project.groupId : groupOf(target)
    // Esce solo il nome riconosciuto: il testo libero del Modulo può portare il nome di una persona (M7).
    const forLabel =
      project?.title ?? context.groups.find((group) => group.id === groupId)?.name ?? (isOrgan(target) ? target : '')
    if (target && !forLabel)
      read.warn(
        `«cantiere o GdL» vale «${target}»: non è un GdL, un cantiere o un organo di RAMI che conosco, e non esce.`,
      )
    const assigneeRole = read.role('ruolo di chi lo prende')
    if ((status === 'taken' || status === 'ongoing' || status === 'delivered') && !assigneeRole && !forLabel)
      read.warn(
        `l’impegno è «${COMMITMENT_STATUS_LABELS[status].toLowerCase()}», ma mancano il «ruolo di chi lo prende» e ` +
          `il «cantiere o GdL»: si mostra solo «${COMMITMENT_STATUS_LABELS[status]}».`,
      )

    // L'anno in cui l'impegno si conta (O10). Il modello non ha la data di chiusura: senza «anno» un impegno vivo è
    // dell'anno di oggi, un chiuso dell'anno della ratifica, un respinto di quello della proposta.
    const writtenYear = Number(text(row.get('anno')))
    let year = Number(context.today.slice(0, 4))
    if (Number.isInteger(writtenYear) && writtenYear > 2000) year = writtenYear
    else if (status === 'closed') {
      year = Number((ratifiedOn ?? proposedOn ?? context.today).slice(0, 4))
      read.warn(
        `l’impegno è chiuso e manca «anno»: lo conto nel ${year}, ` +
          `${ratifiedOn ? 'l’anno della ratifica' : proposedOn ? 'l’anno della proposta' : 'l’anno di oggi'}. ` +
          'Scrivi l’anno in cui si è chiuso.',
      )
    } else if (!isAlive(status)) year = Number((proposedOn ?? context.today).slice(0, 4))
    const proposedCell = row.get('proposto il')

    commitments.push({
      index: row.index,
      proposedAt: proposedCell instanceof Date ? proposedCell.getTime() : null,
      id,
      year,
      title: text(row.get('titolo')),
      status,
      outcome: status === 'closed' ? (outcome ?? null) : null,
      rejectionReason: status === 'rejected' ? rejectionReason : '',
      what: text(row.get('cosa si fa')),
      forLabel,
      groupId: groupId ?? null,
      days: amount('giornate'),
      until: date('fino a quando'),
      term: choice('tipo', TERM_WORDS),
      deliverables: text(row.get('consegne')),
      verifierNumber: number('chi verifica (numero socio)', { who: 'chi verifica', numbers: people }),
      pay: choice('retribuzione', PAY_WORDS),
      fee: amount('compenso'),
      feeVisible: visible ?? false,
      proposedBy: number('proposto da (numero socio)', { who: 'chi propone', numbers: people }),
      proposedOn,
      coordinationOn,
      ratifiedOn,
      howToLeave: text(row.get('come si lascia')),
      howToRevoke: text(row.get('come si revoca')),
      assigneeNumber: number('incaricato (numero socio)'),
      assigneeRole,
      substituteNumber: number('sostituto (numero socio)'),
    })
  }
  return commitments
}

/** Le righe «da scrivere», come si scelgono nell'elenco del Modulo. */
export const rowsToWrite = (commitments: readonly CommitmentRow[]) =>
  commitments.filter((commitment) => commitment.status === 'toWrite').map(commitmentLabel)

/**
 * «Impegni da scrivere» di «Oggi»: le righe che aspettano la scheda. Null se la scheda «Impegni» non c'è ancora; se
 * non si legge, `problem` lo dice, e il resto di «Oggi» si mostra lo stesso.
 */
export function countToWrite(
  content: Workbook,
  toCalendarDate: ToCalendarDate,
  today: CalendarDate,
): { count: number | null; problem: string } {
  if (!content.values(SHEETS.commitments.name)) return { count: null, problem: '' }
  try {
    const rows = readCommitments(readTable(content, SHEETS.commitments), {
      toCalendarDate,
      warnings: [],
      groups: [],
      projects: [],
      memberNumbers: [],
      feeVisibleDefault: false,
      today,
    })
    return { count: rows.filter((commitment) => commitment.status === 'toWrite').length, problem: '' }
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    return { count: null, problem: error.message }
  }
}

const sameText = (a: string, b: string) => normalize(a) === normalize(b)

/**
 * Il budget di un impegno dalla scheda «Budget», come per i cantieri: la voce col suo codice («… (IMP-0003)») o col
 * suo titolo. Null se il tesoriere non l'ha scritto.
 */
export function commitmentBudget(
  commitment: { id: string; title: string },
  lines: readonly BudgetLine[],
): Pick<BudgetLine, 'planned' | 'spent'> {
  const line =
    lines.find((candidate) => commitmentIdIn(candidate.label) === commitment.id) ??
    lines.find((candidate) => commitment.title && sameText(candidate.label, commitment.title))
  return { planned: line?.planned ?? null, spent: line?.spent ?? null }
}

/** I cambi di una riga di «Impegni», per nome di colonna. */
export type CommitmentChange = { id: string; index: number; cells: Record<string, unknown> }

export type CommitmentOutcomeRow = { response: FormResponse<CommitmentAnswer>; outcome: string }

/** Dal Modulo si scrive solo una scheda che il Coordinamento non ha ancora approvato. */
const WRITABLE: readonly CommitmentStatus[] = ['toWrite', 'proposed']

/** Il Foglio tiene le ore coi secondi: entro un secondo, «proposto il» è il momento d'invio della risposta. */
const sameInstant = (at: number | null, submittedAt: Date) => at !== null && Math.abs(at - submittedAt.getTime()) < 1000

/**
 * Le risposte nuove, dalla più vecchia: ognuna completa la riga scelta, che diventa «proposto», e non nasce mai una
 * riga nuova. Vale la prima: una riga già proposta da un'altra risposta, in questo giro o in uno prima, non si
 * riscrive, e la risposta va in «Da controllare». Si riscrive solo la stessa risposta, quando torna perché il giro si
 * era fermato fra la riga e il registro: «proposto il» è il suo momento d'invio.
 */
export function applyCommitmentResponses(
  responses: readonly FormResponse<CommitmentAnswer>[],
  commitments: readonly CommitmentRow[],
  settings: { memberNumbers: readonly string[]; feeVisibleDefault: boolean },
): { outcomes: CommitmentOutcomeRow[]; changes: CommitmentChange[] } {
  const outcomes: CommitmentOutcomeRow[] = []
  const changes = new Map<string, CommitmentChange>()
  for (const response of responses) {
    const { answer } = response
    const problem = (reason: string) => outcomes.push({ response, outcome: `${NOT_APPLIED}: ${reason}` })
    const id = commitmentIdIn(answer.row)
    const commitment = id ? commitments.find((candidate) => candidate.id === id) : undefined
    const days = readAmount(answer.days)
    const term = TERM_WORDS.read(answer.term)
    const pay = PAY_WORDS.read(answer.pay)
    const fee = readAmount(answer.fee)
    const proposer = answer.proposer.trim()
    const firstName = answer.proposerFirstName.trim()
    const lastName = answer.proposerLastName.trim()
    const email = answer.proposerEmail.trim()
    const verifier = answer.verifier.trim()
    const reason = !id
      ? 'non è scelto nessun impegno da scrivere'
      : !commitment
        ? `l’impegno ${id} non c’è nella scheda «Impegni»`
        : changes.has(id) ||
            (commitment.status === 'proposed' && !sameInstant(commitment.proposedAt, response.submittedAt))
          ? `l’impegno ${id} è già stato proposto da un’altra risposta`
          : !WRITABLE.includes(commitment.status)
            ? `l’impegno ${id} è «${COMMITMENT_STATUS_LABELS[commitment.status]}»: la scheda non si cambia dal Modulo`
            : typeof days !== 'number' || days <= 0
              ? `le giornate «${answer.days}» non le leggo`
              : !isCalendarDate(answer.until)
                ? `la data «${answer.until}» non la leggo`
                : !term
                  ? `il tipo «${answer.term}» non lo conosco`
                  : !pay
                    ? `la retribuzione «${answer.pay}» non la conosco`
                    : pay === 'paid' && (typeof fee !== 'number' || fee <= 0)
                      ? 'per un compenso serve la cifra'
                      : !settings.memberNumbers.includes(verifier)
                        ? `chi verifica (${verifier}) non è fra le Persone della Riservata`
                        : !firstName || !lastName
                          ? 'mancano il nome o il cognome di chi propone'
                          : !proposer
                            ? 'manca il numero socio di chi propone'
                            : !settings.memberNumbers.includes(proposer)
                              ? `chi propone (${proposer}) non è fra le Persone della Riservata`
                              : !EMAIL.test(email)
                                ? 'la mail di chi propone non è una mail'
                                : null
    if (reason || !commitment || !id || !term || !pay) {
      problem(reason ?? 'risposta incompleta')
      continue
    }
    const visible = answer.feeVisible ? readYesNo(answer.feeVisible) : settings.feeVisibleDefault
    changes.set(id, {
      id,
      index: commitment.index,
      cells: {
        stato: STATUS_WORDS.cell('proposed'),
        'cosa si fa': answer.what.trim(),
        'cantiere o GdL': answer.for.trim(),
        giornate: days,
        'fino a quando': answer.until,
        tipo: TERM_WORDS.cell(term),
        consegne: answer.deliverables.trim(),
        'chi verifica (numero socio)': verifier,
        retribuzione: PAY_WORDS.cell(pay),
        compenso: pay === 'paid' ? fee : '',
        'compenso visibile ai soci': visible ? 'sì' : 'no',
        'proposto da (numero socio)': proposer,
        'proposto da (nome)': firstName,
        'proposto da (cognome)': lastName,
        'proposto da (mail)': email,
        'proposto il': response.submittedAt,
        'come si lascia': answer.leave.trim(),
        'come si revoca': answer.revoke.trim(),
      },
    })
    outcomes.push({ response, outcome: `applicata a ${id}` })
  }
  return { outcomes, changes: [...changes.values()] }
}
