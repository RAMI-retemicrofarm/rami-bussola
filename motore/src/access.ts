// La lista di Access: chi entra nella Riservata. La tiene a mano chi cura la Bussola, in Cloudflare Access; il motore
// non tocca Access, la ricava da «Persone della Riservata» e la dice in «Salute», con chi entra e chi esce dall'ultima
// volta. Chi esce va tolto da Access a mano, e le sue sessioni revocate.
import { normalizeEmail } from '@bussola/condiviso'
import type { PersonRow } from './content.ts'

/** Il piano gratuito di Access tiene 50 persone. */
export const ACCESS_FREE_SEATS = 50

/** Le mail normalizzate delle persone con almeno un ruolo, senza doppioni, nell'ordine del Foglio. */
export function accessList(people: readonly PersonRow[]): string[] {
  const list: string[] = []
  for (const person of people) {
    if (!person.roles.length) continue
    const email = normalizeEmail(person.email)
    if (list.indexOf(email) < 0) list.push(email)
  }
  return list
}

export type AccessHealth = { status: 'a posto' | 'da guardare'; note: string; changed: boolean }

const people = (count: number) => (count === 1 ? '1 persona' : `${count} persone`)

/**
 * La riga di «Salute»: la lista intera la prima volta, chi entra e chi esce quando cambia. Se è uguale, anche in un
 * altro ordine, resta la nota dell'ultimo cambio, così chi cura la Bussola la ritrova finché non ha allineato Access.
 */
export function accessHealth(
  list: readonly string[],
  previous: readonly string[] | null,
  lastNote: string | null = null,
): AccessHealth {
  const status = list.length > ACCESS_FREE_SEATS ? 'da guardare' : 'a posto'
  const entering = previous ? list.filter((email) => previous.indexOf(email) < 0) : [...list]
  const leaving = previous ? previous.filter((email) => list.indexOf(email) < 0) : []
  const changed = previous === null || entering.length > 0 || leaving.length > 0
  if (!changed && lastNote) return { status, note: lastNote, changed }

  const parts: string[] = []
  if (entering.length) parts.push(`entra ${entering.join(', ')}`)
  if (leaving.length) parts.push(`esce ${leaving.join(', ')}`)
  const head =
    previous === null
      ? `Prima lista, da copiare in Access: ${list.join(', ') || 'nessuna persona'}.`
      : parts.length
        ? `Cambiata: ${parts.join('; ')}.`
        : 'Uguale all’ultima.'
  const tail =
    status === 'da guardare' ? ` Sono più di ${ACCESS_FREE_SEATS}: Access gratis ne tiene ${ACCESS_FREE_SEATS}.` : ''
  return { status, note: `${head} In tutto ${people(list.length)}.${tail}`, changed }
}
