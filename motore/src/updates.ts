// Le risposte del Modulo «Aggiorna il cantiere» applicate ai cantieri (flusso F4). Il gruppo si riconosce dal suo
// codice, che è casuale e unico: un codice sbagliato non cambia niente, e la risposta va in «Da controllare».
// Un cantiere nuovo col titolo di uno aperto dello stesso gruppo aggiorna quello: così un invio doppio, o una risposta
// riletta dopo un giro interrotto, non fa due cantieri. Funzioni pure: il giro del motore scrive nel Foglio ciò che
// esce da qui.
import { isCalendarDate, type CalendarDate, type Stage } from '@bussola/condiviso'
import { parseStage, type GroupRow, type ProjectRow } from './content.ts'
import { projectIdIn, type FormResponse } from './form.ts'

export type ProjectChange = {
  id: string
  isNew: boolean
  groupId: string
  title: string
  stage: Stage
  lastNews: string
  nextStep: string
  dueOn: CalendarDate | null
  helpWanted: string
  /** «Aggiornato il»: l'ora della risposta valida. */
  updatedAt: Date
  closedAt: Date | null
}

export type ResponseOutcome = { response: FormResponse; outcome: string }

export const NOT_APPLIED = 'da controllare'

const numberOf = (id: string) => Number(/^CAN-(\d+)$/.exec(id)?.[1] ?? 0)
const sameTitle = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

type Known = Pick<ProjectRow, 'id' | 'groupId' | 'title' | 'stage'>

/**
 * `takenIds`: ogni id della scheda «Cantieri», anche delle righe che non si leggono, perché un cantiere nuovo non
 * prenda un numero che c'è già.
 */
export function applyUpdates(
  responses: FormResponse[],
  groups: GroupRow[],
  projects: ProjectRow[],
  takenIds: readonly string[] = projects.map((project) => project.id),
): { outcomes: ResponseOutcome[]; changes: ProjectChange[] } {
  const outcomes: ResponseOutcome[] = []
  const changes = new Map<string, ProjectChange>()
  const known: Known[] = [...projects]
  let lastNumber = Math.max(0, ...takenIds.map(numberOf))

  for (const response of responses) {
    const { answer } = response
    const reject = (reason: string) => outcomes.push({ response, outcome: `${NOT_APPLIED}: ${reason}` })
    const matching = answer.code ? groups.filter((candidate) => candidate.formKey === answer.code) : []
    const [group] = matching
    if (!group) {
      reject('codice del gruppo sbagliato')
      continue
    }
    if (matching.length > 1) {
      reject('il codice del gruppo è di più gruppi')
      continue
    }
    const stage = parseStage(answer.stage)
    if (!stage) {
      reject(`lo stato «${answer.stage}» non lo conosco`)
      continue
    }
    const projectId = projectIdIn(answer.project)
    const title = answer.project.trim()
    const existing = projectId
      ? known.find((project) => project.id === projectId)
      : title
        ? known.find(
            (project) => project.groupId === group.id && project.stage !== 'closed' && sameTitle(project.title, title),
          )
        : undefined
    if (projectId && existing?.groupId !== group.id) {
      reject(`il cantiere ${projectId} non è di questo gruppo`)
      continue
    }
    const fields = {
      groupId: group.id,
      stage,
      lastNews: answer.news.trim(),
      nextStep: answer.nextStep.trim(),
      dueOn: isCalendarDate(answer.dueOn) ? answer.dueOn : null,
      helpWanted: answer.help.trim(),
      updatedAt: response.submittedAt,
      closedAt: stage === 'closed' ? response.submittedAt : null,
    }
    if (existing) {
      // Due risposte per lo stesso cantiere nella stessa volta: vale l'ultima, e un cantiere nuovo resta nuovo.
      const before = changes.get(existing.id)
      changes.set(existing.id, { ...fields, id: existing.id, isNew: before?.isNew ?? false, title: existing.title })
      outcomes.push({ response, outcome: `applicata a ${existing.id}` })
    } else {
      const id = `CAN-${String(++lastNumber).padStart(4, '0')}`
      const change = { ...fields, id, isNew: true, title: title || 'Cantiere senza nome' }
      changes.set(id, change)
      if (title) known.push(change)
      outcomes.push({ response, outcome: `nuovo cantiere ${id}` })
    }
  }
  return { outcomes, changes: [...changes.values()] }
}
