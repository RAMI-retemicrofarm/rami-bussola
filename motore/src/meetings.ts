// Le risposte del Modulo «Prossimo incontro» (T7): ognuna diventa una riga della scheda «Incontri». Il gruppo si
// riconosce dal codice, come per i cantieri: un codice sbagliato non pubblica niente, e la riga resta «da controllare».
// Funzione pura: il giro del motore scrive nel Foglio ciò che esce da qui.
import { isCalendarDate, isLocalDateTime, isMeetUrl } from '@bussola/condiviso'
import type { FormResponse, MeetingAnswer } from './form.ts'
import { NOT_APPLIED } from './updates.ts'

export type MeetingOutcome = {
  response: FormResponse<MeetingAnswer>
  /** Le celle di «Incontri», per nome di colonna. */
  cells: Record<string, string>
  outcome: string
}

export function applyMeetingResponses(
  responses: FormResponse<MeetingAnswer>[],
  groups: readonly { id: string; formKey: string }[],
): MeetingOutcome[] {
  return responses.map((response) => {
    const { answer } = response
    const matching = answer.code ? groups.filter((group) => group.formKey === answer.code) : []
    const time = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(answer.time)
    const startsAt = time ? `${answer.day}T${(time[1] ?? '').padStart(2, '0')}:${time[2]}` : ''
    const problem = !matching.length
      ? 'codice del gruppo sbagliato'
      : matching.length > 1
        ? 'il codice del gruppo è di più gruppi'
        : !isCalendarDate(answer.day)
          ? `il giorno «${answer.day}» non lo leggo`
          : !isLocalDateTime(startsAt)
            ? `l’ora «${answer.time}» non la leggo`
            : !isMeetUrl(answer.meet)
              ? 'il link non è di Meet'
              : null
    return {
      response,
      cells: {
        // Con un codice sbagliato resta ciò che è scritto, perché chi controlla capisca da dove viene.
        GdL: matching.length === 1 ? (matching[0]?.id ?? '') : answer.group,
        'data e ora': startsAt ? startsAt.replace('T', ' ') : `${answer.day} ${answer.time}`.trim(),
        'link Meet': answer.meet,
        'visibile ai soci': answer.visible.trim().toLowerCase() === 'sì' ? 'sì' : 'no',
      },
      outcome: problem ? `${NOT_APPLIED}: ${problem}` : 'aggiunto',
    }
  })
}
