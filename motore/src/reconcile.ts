// L'abbinamento dell'estratto conto col registro dei pagamenti (T4): funzione pura, provata in Node. Un bonifico in
// banca si abbina a un pagamento registrato per riferimento, oppure per «socio n. <numero>» nella causale con la data
// entro 7 giorni; in tutti e due i casi l'importo deve tornare. Il resto va in «Da abbinare»: i bonifici in banca senza
// registrazione, le registrazioni di bonifico senza riga in banca dopo 45 giorni, i pagamenti registrati senza socio.
// Le righe già incollate le scarta l'importazione con `splitPasted`; nella scheda ogni riga conta, e le righe uguali
// non ancora abbinate tutte vanno in «Da controllare» per 45 giorni. Prima dell'abbinamento si mettono da parte le
// righe che non sono quote: quelle che non si leggono, le uscite e gli importi a zero, le iscrizioni al Raduno, che il
// tesoriere vuole con un bonifico a parte (25/10/2026), e quelle che chi registra ha segnato «Non è una quota».
import { daysBetween, type CalendarDate, type PaymentMethod, type PaymentStatus } from '@bussola/condiviso'

/** Una riga della scheda «Estratto conto». */
export type BankLine = {
  /** La riga della scheda, con l'intestazione nella riga 0. */
  index: number
  /** Vuota se la cella non si legge. */
  date: CalendarDate | ''
  /** Null se la cella non si legge. */
  amount: number | null
  reason: string
  reference: string
  /** «abbinato a»: gli id dei pagamenti, scritti dall'importazione. */
  matchedTo: string
  ignoredWhy: string
}

/** Ciò che dell'abbinamento serve di un pagamento: i campi del contratto della pagina. */
export type ReconcilePayment = {
  id: string
  memberNumber: string
  validYear: number
  amount: number
  date: CalendarDate | ''
  method: PaymentMethod
  reference: string
  status: PaymentStatus
  recordedBy: string
  recordedOn: CalendarDate | ''
}

/** Per «socio n. 123» la data del bonifico deve stare entro questi giorni dalla data registrata. */
export const MATCH_WINDOW_DAYS = 7
/** Una registrazione di bonifico senza riga in banca da questi giorni in poi è da abbinare. */
export const MISSING_AFTER_DAYS = 45
/**
 * Le righe uguali sono da controllare fino a questi giorni dalla loro data. Senza riferimento né «socio n.» non si
 * abbinano mai, e senza un limite «Niente da controllare» non tornerebbe più; le righe non abbinate restano comunque
 * in «Da abbinare».
 */
export const SAME_LINES_DAYS = 45

export type ReconcileSettings = {
  today: CalendarDate
  windowDays?: number
  missingAfterDays?: number
  sameLinesDays?: number
}

export type MatchedLine = { line: BankLine; paymentIds: string[]; how: 'reference' | 'member' }

export type ToMatch =
  | { kind: 'bankWithoutPayment'; line: BankLine; memberNumber: string | null }
  | { kind: 'paymentWithoutBank'; payment: ReconcilePayment; daysAgo: number }
  | { kind: 'paymentWithoutMember'; payment: ReconcilePayment }

export type ReconcileResult = {
  matched: MatchedLine[]
  toMatch: ToMatch[]
  /**
   * I gruppi di righe uguali (bonifici, non uscite) con almeno una non abbinata e una data degli ultimi 45 giorni:
   * possono essere due quote vere senza riferimento, o la stessa scritta due volte a mano nella scheda, e «Da
   * controllare» lo chiede finché non sono abbinate tutte o la data non è passata.
   */
  sameLines: BankLine[][]
  /**
   * Le righe col riferimento di un pagamento registrato, o col suo «socio n.» nei 7 giorni, ma con un altro importo:
   * non si abbinano.
   */
  amountMismatch: { line: BankLine; paymentIds: string[]; registered: number; how: MatchedLine['how'] }[]
  /**
   * Le righe messe da parte, che non si abbinano: quelle che non si leggono, le uscite e gli importi a zero, le
   * iscrizioni al Raduno e quelle segnate a mano «Non è una quota», col motivo scritto da chi l'ha segnata.
   */
  ignored: IgnoredLine[]
}

export type IgnoredKind = 'unreadable' | 'outflow' | 'raduno' | 'notDues'
export type IgnoredLine = { line: BankLine; why: string; kind: IgnoredKind }

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

/** «007» vale «7»: il numero socio come lo scrive la scheda Soci, senza zeri davanti. */
const plainNumber = (value: string) => (/^\d+$/.test(value) ? String(Number(value)) : value)

/**
 * Il numero socio nella causale: «socio n. 123», «socio n.123», «socio n° 123», «socio numero 123», e così «socia».
 * Un anno fra «socio» e «n.» si salta: la causale delle istruzioni è «tesseramento socio 2027 n. 12». «socio 2027» da
 * solo non è un numero socio.
 */
export function memberNumberInReason(reason: string): string | null {
  const match = /\bsoci[oa]\s*(?:(?:19|20)\d{2}\s*)?(?:n(?:r)?\.?|n[°º]|numero)\s*(\d+)\b/i.exec(reason)
  return match?.[1] === undefined ? null : plainNumber(match[1])
}

/** Due righe con la stessa data, importo, causale e riferimento sono uguali. */
export const bankLineKey = (line: BankLine): string =>
  [line.date, line.amount, normalize(line.reason), normalize(line.reference)].join('|')

/**
 * Quali righe incollate sono nuove. Una riga col riferimento entra una volta sola: un CRO o un TRN è unico per
 * operazione, quindi una copia, nella scheda o già nel blocco, è la stessa riga incollata due volte. Senza riferimento
 * conta il numero: se il blocco porta N righe uguali e la scheda ne ha già E, ne entrano max(0, N − E) e le altre sono
 * già incollate. Così reincollare lo stesso estratto non aggiunge niente, anche senza riferimento; due bonifici veri
 * uguali senza riferimento nello stesso estratto entrano tutti e due; un estratto che si sovrappone al vecchio
 * aggiunge solo le righe in più.
 */
export function splitPasted(
  existing: readonly BankLine[],
  pasted: readonly BankLine[],
): { fresh: BankLine[]; alreadyPasted: BankLine[] } {
  const inSheet = new Map<string, number>()
  for (const line of existing) inSheet.set(bankLineKey(line), (inSheet.get(bankLineKey(line)) ?? 0) + 1)
  const fresh: BankLine[] = []
  const alreadyPasted: BankLine[] = []
  const seen = new Set<string>()
  for (const line of pasted) {
    const key = bankLineKey(line)
    if (normalize(line.reference)) {
      if (inSheet.has(key) || seen.has(key)) alreadyPasted.push(line)
      else fresh.push(line)
      seen.add(key)
      continue
    }
    const left = inSheet.get(key) ?? 0
    if (left > 0) {
      inSheet.set(key, left - 1)
      alreadyPasted.push(line)
    } else fresh.push(line)
  }
  return { fresh, alreadyPasted }
}

/** La riga non si legge: «Da controllare» lo dice finché qualcuno non corregge la cella. */
export const unreadable = (line: BankLine): boolean => !line.date || line.amount === null

/** I perché che l'abbinamento scrive in «ignorato perché» quando una cella non va. */
const CELL_REASONS = {
  date: 'la data non si legge',
  amount: 'l’importo non si legge',
  outflow: 'è un’uscita',
  zero: 'l’importo è zero',
} as const
/** Il perché delle iscrizioni al Raduno, nella scheda e nella pagina. */
export const RADUNO_REASON = 'Iscrizione al Raduno'

const RADUNO = /raduno/i
/**
 * I segnali di una quota: «socio» o «socia» al singolare, con o senza numero («socio 12», «socia n. 12»), iscritto e
 * associato in ogni forma (anche «associativo»), un numero progressivo («n. 12», «nr 12», «n° 12», «numero 12»),
 * tesseramento e tessera, quota e quote, rinnovo, adesione, iscrizione (tranne «iscrizione al Raduno»). «(solo soci)»,
 * al plurale, sta nella causale del Raduno e non conta.
 */
const DUES_SIGNAL =
  /\b(?:soci[oa]|iscritt\w*|associat\w*|tesser\w*|quot[ae]|rinnov\w*|adesion\w*)\b|\b(?:nr?\.?|n[°º]|numero)\s*\d|\biscrizion[ei]\b(?!\s+(?:(?:al|per\s+il)\s+)?raduno)/i

/**
 * L'iscrizione al Raduno va con un bonifico a parte, con la causale «raduno rete microfarm 2027 (solo soci)». Si mette
 * da parte solo ciò che è chiaramente il Raduno: «raduno» e nessun segnale di quota. Nel dubbio la riga segue
 * l'abbinamento: in «Da abbinare» o in «Da controllare» l'errore si vede e «Non è una quota» lo sistema, mentre una
 * quota messa da parte come Raduno sparirebbe senza che nessuno se ne accorga.
 */
const radunoOnly = (reason: string) => RADUNO.test(reason) && !DUES_SIGNAL.test(reason)

function setAside(line: BankLine): { why: string; kind: IgnoredKind } | null {
  if (!line.date) return { why: CELL_REASONS.date, kind: 'unreadable' }
  if (line.amount === null) return { why: CELL_REASONS.amount, kind: 'unreadable' }
  if (line.amount < 0) return { why: CELL_REASONS.outflow, kind: 'outflow' }
  if (line.amount === 0) return { why: CELL_REASONS.zero, kind: 'outflow' }
  if (radunoOnly(line.reason)) return { why: RADUNO_REASON, kind: 'raduno' }
  return null
}

/**
 * I perché che scrive l'abbinamento, da un elenco solo: si ricalcolano a ogni importazione, e non sono motivi a mano.
 * Con la causale corretta, una riga scritta «Iscrizione al Raduno» torna all'abbinamento.
 */
const AUTO_REASONS = new Set<string>([...Object.values(CELL_REASONS), RADUNO_REASON].map(normalize))

/** Il motivo scritto è uno dei perché dell'abbinamento: come motivo a mano si perderebbe alla prima importazione. */
export const isAutoReason = (why: string): boolean => AUTO_REASONS.has(normalize(why))

/**
 * Il motivo di «Non è una quota», scritto da chi registra in «ignorato perché»: vale finché non lo si cancella dalla
 * scheda, e l'importazione non lo tocca. I perché dell'abbinamento non sono motivi a mano: corretta la cella o la
 * causale, la riga torna all'abbinamento.
 */
export function notDuesWhy(line: BankLine): string {
  const why = line.ignoredWhy.trim()
  return isAutoReason(why) ? '' : why
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Per il confronto per frammento: un riferimento più corto è comune, e abbinerebbe righe estranee. */
export const MIN_REFERENCE_LENGTH = 5

/**
 * Il riferimento della banca e quello registrato sono lo stesso se sono uguali, oppure se uno sta intero dentro
 * l'altro, che spesso è più lungo («TRN 55001» per «55001»). Per il confronto per frammento servono almeno 5 segni:
 * «5501» dentro «TRN 5501» è troppo comune. L'uguaglianza vale a ogni lunghezza: l'importo diverso la ferma comunque.
 */
export function referenceMatches(bank: string, registered: string): boolean {
  const left = normalize(bank)
  const right = normalize(registered)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length < MIN_REFERENCE_LENGTH || right.length < MIN_REFERENCE_LENGTH) return false
  const [short, long] = right.length <= left.length ? [right, left] : [left, right]
  return new RegExp(`(?:^|[^\\w])${escape(short)}(?:$|[^\\w])`).test(long)
}

const cents = (amount: number) => Math.round(amount * 100)

const byDateThenId = (a: ReconcilePayment, b: ReconcilePayment) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

export function reconcile(
  bankLines: readonly BankLine[],
  payments: readonly ReconcilePayment[],
  settings: ReconcileSettings,
): ReconcileResult {
  const windowDays = settings.windowDays ?? MATCH_WINDOW_DAYS
  const missingAfterDays = settings.missingAfterDays ?? MISSING_AFTER_DAYS
  const transfers = payments.filter((payment) => payment.method === 'transfer' && payment.status !== 'cancelled')
  const ignored: IgnoredLine[] = []
  const lines: BankLine[] = []
  for (const line of [...bankLines].sort((a, b) => a.index - b.index)) {
    // Il riferimento viene prima del Raduno: una riga che un pagamento registrato rivendica si abbina.
    const claimed = (aside: { kind: IgnoredKind } | null) =>
      aside?.kind === 'raduno' && transfers.some((payment) => referenceMatches(line.reference, payment.reference))
    const found = setAside(line)
    const aside = claimed(found) ? null : found
    const byHand = aside ? '' : notDuesWhy(line)
    if (aside) ignored.push({ line, ...aside })
    else if (byHand) ignored.push({ line, why: byHand, kind: 'notDues' })
    else lines.push(line)
  }

  // Un pagamento si abbina una volta sola: prima per riferimento, su tutte le righe, poi per socio. Col riferimento
  // di un pagamento ma un altro importo la riga non si abbina: «Da controllare» la segnala.
  const taken = new Set<string>()
  const matches = new Map<BankLine, MatchedLine>()
  const amountMismatch: ReconcileResult['amountMismatch'] = []
  for (const line of lines) {
    const found = transfers.filter(
      (payment) => !taken.has(payment.id) && referenceMatches(line.reference, payment.reference),
    )
    if (!found.length) continue
    const paymentIds = found.map((payment) => payment.id)
    const registered = found.reduce((sum, payment) => sum + payment.amount, 0)
    if (cents(registered) !== cents(line.amount ?? 0)) {
      amountMismatch.push({ line, paymentIds, registered: cents(registered) / 100, how: 'reference' })
      continue
    }
    for (const payment of found) taken.add(payment.id)
    matches.set(line, { line, paymentIds, how: 'reference' })
  }
  // Per socio: il primo pagamento dei 7 giorni con lo stesso importo, oppure tutti insieme se la somma torna (due
  // quote in un bonifico). Con pagamenti del socio nei 7 giorni ma un altro importo, la riga è da controllare. Le righe
  // che parlano del Raduno passano per ultime: chi aggiunge «socio n. 7» all'iscrizione non prende la quota del 7.
  const toMatch: ToMatch[] = []
  const radunoLast = (a: BankLine, b: BankLine) => Number(RADUNO.test(a.reason)) - Number(RADUNO.test(b.reason))
  for (const line of [...lines].sort(radunoLast)) {
    if (matches.has(line) || amountMismatch.some((item) => item.line === line)) continue
    const memberNumber = memberNumberInReason(line.reason)
    const candidates = memberNumber
      ? transfers
          .filter(
            (payment) =>
              !taken.has(payment.id) &&
              plainNumber(payment.memberNumber) === memberNumber &&
              payment.date !== '' &&
              Math.abs(daysBetween(payment.date, line.date)) <= windowDays,
          )
          .sort(byDateThenId)
      : []
    const amount = cents(line.amount ?? 0)
    const same = candidates.find((payment) => cents(payment.amount) === amount)
    const total = candidates.reduce((sum, payment) => sum + cents(payment.amount), 0)
    const found = same ? [same] : candidates.length > 1 && total === amount ? candidates : []
    if (found.length) {
      for (const payment of found) taken.add(payment.id)
      matches.set(line, { line, paymentIds: found.map((payment) => payment.id), how: 'member' })
    } else if (candidates.length)
      amountMismatch.push({
        line,
        paymentIds: candidates.map((payment) => payment.id),
        registered: total / 100,
        how: 'member',
      })
    else toMatch.push({ kind: 'bankWithoutPayment', line, memberNumber })
  }
  // Le righe del Raduno sono passate per ultime solo per scegliere chi prende il pagamento: gli elenchi seguono il Foglio.
  // Qui in toMatch ci sono solo righe della banca: le registrazioni arrivano dopo.
  const lineIndex = (item: ToMatch) => (item.kind === 'bankWithoutPayment' ? item.line.index : 0)
  toMatch.sort((a, b) => lineIndex(a) - lineIndex(b))
  amountMismatch.sort((a, b) => a.line.index - b.line.index)

  // Le righe uguali, finché non sono abbinate tutte e per 45 giorni: una sola voce per gruppo, con tutte le sue righe.
  const sameLinesDays = settings.sameLinesDays ?? SAME_LINES_DAYS
  const groups = new Map<string, BankLine[]>()
  for (const line of lines) groups.set(bankLineKey(line), [...(groups.get(bankLineKey(line)) ?? []), line])
  const sameLines = [...groups.values()].filter(
    (group) =>
      group.length > 1 &&
      group.some((line) => !matches.has(line)) &&
      daysBetween(group[0]?.date as CalendarDate, settings.today) <= sameLinesDays,
  )

  // Le registrazioni senza riga in banca: solo nel periodo che l'estratto conto copre, e dopo 45 giorni.
  const dates = lines.map((line) => line.date).sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first && last)
    for (const payment of [...transfers].sort(byDateThenId)) {
      if (taken.has(payment.id) || !payment.date || payment.date < first || payment.date > last) continue
      const daysAgo = daysBetween(payment.date, settings.today)
      if (daysAgo >= missingAfterDays) toMatch.push({ kind: 'paymentWithoutBank', payment, daysAgo })
    }
  for (const payment of payments
    .filter((payment) => payment.status !== 'cancelled' && !payment.memberNumber.trim())
    .sort(byDateThenId))
    toMatch.push({ kind: 'paymentWithoutMember', payment })

  return {
    matched: lines.flatMap((line) => matches.get(line) ?? []),
    toMatch,
    sameLines,
    amountMismatch,
    ignored,
  }
}
