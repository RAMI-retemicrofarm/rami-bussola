// Il Modulo «Aggiorna il cantiere» (flussi critici, C): le domande, come si leggono le risposte e il link
// precompilato. La preparazione lo crea da qui (google.ts), così domande, aiuti e messaggio finale stanno nel codice.
// I Moduli non hanno campi nascosti: il codice del gruppo sta in un campo visibile, «non cambiarlo».

export type UpdateField = 'group' | 'project' | 'code' | 'who' | 'stage' | 'news' | 'nextStep' | 'dueOn' | 'help'

export type Question = {
  field: UpdateField
  title: string
  help: string
  kind: 'text' | 'paragraph' | 'choice' | 'date'
  required: boolean
  choices?: readonly string[]
}

export const BUSSOLA_URL = 'https://rami-bussola.pages.dev'

/** L'informativa, aperta a tutti sul dominio dei soci: ogni Modulo che raccoglie dati la collega. */
export const PRIVACY_URL = 'https://bussola.retemicrofarm.it/privacy'

export const UPDATE_FORM = {
  title: 'Aggiorna il cantiere',
  description:
    'Gruppo, cantiere e codice del gruppo sono già scritti. Ci vuole un minuto.\n\n' +
    `Come usiamo i dati: ${PRIVACY_URL}`,
  confirmation:
    'Grazie! Il tuo aggiornamento è arrivato. Sulla Bussola lo vedrai entro 10 minuti.\n\n' +
    `Torna alla Bussola: ${BUSSOLA_URL}/cantieri`,
  questions: [
    { field: 'group', title: 'Gruppo', help: 'Già scritto: non cambiarlo.', kind: 'text', required: true },
    {
      field: 'project',
      title: 'Cantiere',
      help: 'Già scritto se aggiorni un cantiere. Per un cantiere nuovo, scrivi il nome.',
      kind: 'text',
      required: true,
    },
    {
      field: 'code',
      title: 'Codice del gruppo: non cambiarlo',
      help: 'Serve alla Bussola per riconoscere il gruppo.',
      kind: 'text',
      required: true,
    },
    { field: 'who', title: 'Chi sei?', help: 'Il tuo nome.', kind: 'text', required: true },
    {
      field: 'stage',
      title: 'A che punto è?',
      help: '«Chiuso» toglie il cantiere dall’elenco. «Fermo» non si sceglie: lo calcola la Bussola dopo 30 giorni senza aggiornamenti.',
      kind: 'choice',
      required: true,
      choices: ['Avvio', 'In corso', 'In revisione', 'In chiusura', 'Chiuso'],
    },
    {
      field: 'news',
      title: "Cosa è successo dall'ultima volta?",
      help: 'Basta una frase. Esempio: abbiamo fissato la sala per il 5 dicembre.',
      kind: 'paragraph',
      required: true,
    },
    {
      field: 'nextStep',
      title: 'Qual è il prossimo passo?',
      help: "Esempio: mandare l'invito.",
      kind: 'text',
      required: true,
    },
    { field: 'dueOn', title: 'Per quando?', help: 'Esempio: 20 novembre.', kind: 'date', required: true },
    {
      field: 'help',
      title: 'Ti serve aiuto da qualcuno?',
      help: 'Se sì, scrivi da chi e per cosa.',
      kind: 'paragraph',
      required: false,
    },
  ] satisfies Question[],
}

export type UpdateAnswer = Record<UpdateField, string>

export type FormResponse = { id: string; submittedAt: Date; answer: UpdateAnswer }

const normalize = (title: string) => title.trim().toLowerCase()

/** Le risposte si riconoscono dal titolo della domanda; quelle che il motore non conosce si ignorano. */
export function answerFromItems(items: { title: string; response: unknown }[]): UpdateAnswer {
  const answer = Object.fromEntries(UPDATE_FORM.questions.map((question) => [question.field, ''])) as UpdateAnswer
  for (const item of items) {
    const question = UPDATE_FORM.questions.find((candidate) => normalize(candidate.title) === normalize(item.title))
    if (question && typeof item.response === 'string') answer[question.field] = item.response.trim()
  }
  return answer
}

type Prefilled = 'group' | 'project' | 'code'

/** I valori che la preparazione mette nel link di prova, per trovare le domande precompilate (`entry.<id>`). */
export const PREFILL_MARKERS: Record<Prefilled, string> = {
  group: 'BUSSOLAGRUPPO',
  project: 'BUSSOLACANTIERE',
  code: 'BUSSOLACODICE',
}

export type PrefillLinks = { base: string; entries: Record<Prefilled, string> }

/** Dal link di prova che dà Google (`toPrefilledUrl`): l'indirizzo del Modulo e le domande da precompilare. */
export function parsePrefilledUrl(url: string): PrefillLinks {
  const [base = '', query = ''] = url.split('?')
  const params = query.split('&')
  const entries = {} as Record<Prefilled, string>
  for (const field of Object.keys(PREFILL_MARKERS) as Prefilled[]) {
    const param = params.find((candidate) => candidate.endsWith(`=${PREFILL_MARKERS[field]}`))
    if (!param) {
      const title = UPDATE_FORM.questions.find((question) => question.field === field)?.title
      throw new Error(`Il Modulo è cambiato: il link precompilato non ha la domanda «${title}».`)
    }
    entries[field] = param.slice(0, param.indexOf('='))
  }
  return { base: `${base}?usp=pp_url`, entries }
}

export function prefilledUrl(links: PrefillLinks, values: Partial<Record<Prefilled, string>>): string {
  let url = links.base
  for (const field of ['group', 'project', 'code'] as const) {
    const value = values[field]
    if (value) url += `&${links.entries[field]}=${encodeURIComponent(value)}`
  }
  return url
}

/** Il cantiere si scrive nel Modulo col titolo e l'id, e dall'id si ritrova. */
export const projectLabel = (project: { id: string; title: string }) => `${project.title} (${project.id})`

export function projectIdIn(answer: string): string | null {
  const ids = answer.match(/\bCAN-\d+\b/g)
  return ids ? (ids[ids.length - 1] ?? null) : null
}
