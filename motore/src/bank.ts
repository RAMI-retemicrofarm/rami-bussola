// L'estratto conto come lo dà la banca o come lo si incolla da un foglio: CSV con punto e virgola o virgola, oppure
// righe col tab. Con l'intestazione le colonne si trovano per nome; senza, valgono nell'ordine della scheda «Estratto
// conto»: data, importo, causale, riferimento. Ogni riga torna com'è: ciò che non si legge resta vuoto, e
// l'abbinamento (reconcile.ts) lo dice.
import { isCalendarDate, type CalendarDate } from '@bussola/condiviso'

export type ParsedBankLine = {
  date: CalendarDate | ''
  amount: number | null
  reason: string
  reference: string
}

type Column = 'date' | 'amount' | 'in' | 'out' | 'reason' | 'reference'

/** Le intestazioni che le banche usano, senza maiuscole: la prima che torna vince. */
const HEADERS: [RegExp, Column][] = [
  [/^data(?: contabile| operazione| op\.?)?$/, 'date'],
  [/^data valuta$/, 'date'],
  [/^importo(?: in euro| \(eur\)|.*)?$/, 'amount'],
  [/^(?:entrate|avere|accrediti|dare\/avere)$/, 'in'],
  [/^(?:uscite|dare|addebiti)$/, 'out'],
  [/^(?:causale|descrizione|descrizione operazione|dettagli|operazione|descrizione estesa)$/, 'reason'],
  [
    /^(?:riferimento|rif\.?|riferimento operazione|trn|cro|id operazione|numero operazione|codice identificativo)$/,
    'reference',
  ],
]

/** I campi di una riga, con le virgolette del CSV: «"a;b"» è un campo solo, «""» dentro è una virgoletta. */
function splitFields(line: string, separator: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? ''
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === separator) {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields.map((value) => value.trim())
}

/** Il separatore: quello che ricorre di più nella prima riga, fra tab, punto e virgola e virgola. */
function separatorOf(line: string): string {
  const counts = ['\t', ';', ','].map((candidate) => [candidate, line.split(candidate).length - 1] as const)
  return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\t'
}

/** «02/11/2026», «2.11.2026», «02-11-26», «2026-11-02»; vuoto se non è una data che esiste. */
export function readBankDate(value: string): CalendarDate | '' {
  const written = value.trim()
  if (isCalendarDate(written)) return written
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(written)
  if (!match) return ''
  const [, day = '', month = '', year = ''] = match
  const date = `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return isCalendarDate(date) ? date : ''
}

/** «30», «30,50 €», «1.230,50», «1,230.50», «30.00», «-12,00», «EUR 30»; null se non è un numero. */
export function readBankAmount(value: string): number | null {
  let plain = value.replace(/[€\s\u00a0\u202f]|eur/gi, '')
  const negative = plain.startsWith('-')
  plain = plain.replace(/^[+-]/, '')
  if (!plain) return null
  let normalized: string
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(plain) || /^\d+,\d+$/.test(plain))
    normalized = plain.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(plain)) normalized = plain.replace(/,/g, '')
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(plain)) normalized = plain.replace(/\./g, '')
  else if (/^\d+(?:\.\d+)?$/.test(plain)) normalized = plain
  else return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? (negative ? -amount : amount) : null
}

/** L'intestazione, se la prima riga ha una colonna della data e una dell'importo. */
function headerColumns(fields: string[]): Map<Column, number> | null {
  const columns = new Map<Column, number>()
  fields.forEach((name, i) => {
    const column = HEADERS.find(([pattern]) => pattern.test(name.trim().toLowerCase()))?.[1]
    if (column && !columns.has(column)) columns.set(column, i)
  })
  return columns.has('date') && (columns.has('amount') || columns.has('in') || columns.has('out')) ? columns : null
}

export function parseBankText(text: string): ParsedBankLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  const first = rows[0]
  if (!first) return []
  const separator = separatorOf(first)
  const header = headerColumns(splitFields(first, separator))
  const columns =
    header ??
    new Map<Column, number>([
      ['date', 0],
      ['amount', 1],
      ['reason', 2],
      ['reference', 3],
    ])
  const at = (fields: string[], column: Column) => {
    const index = columns.get(column)
    return index === undefined ? '' : (fields[index] ?? '')
  }
  return rows.slice(header ? 1 : 0).map((row) => {
    const fields = splitFields(row, separator)
    let amount: number | null
    if (columns.has('amount')) amount = readBankAmount(at(fields, 'amount'))
    else {
      const incoming = readBankAmount(at(fields, 'in'))
      const outgoing = readBankAmount(at(fields, 'out'))
      amount = incoming !== null ? incoming : outgoing !== null ? -Math.abs(outgoing) : null
    }
    return {
      date: readBankDate(at(fields, 'date')),
      amount,
      reason: at(fields, 'reason'),
      reference: at(fields, 'reference'),
    }
  })
}
