// I Moduli: «Aggiorna il cantiere» (flussi critici, C), da T7 «Prossimo incontro» e da T6 «Proponi un impegno». Le domande,
// come si leggono le risposte e il link precompilato. La preparazione li crea da qui (google.ts), così domande, aiuti
// e messaggio finale stanno nel codice. I Moduli non hanno campi nascosti: il codice del gruppo sta in un campo
// visibile, «non cambiarlo».

export type UpdateField = 'group' | 'project' | 'code' | 'who' | 'stage' | 'news' | 'nextStep' | 'dueOn' | 'help'

export type Question<F extends string = UpdateField> = {
  field: F
  title: string
  help: string
  /**
   * `list` è un elenco a discesa, con le scelte che cambiano: le righe «da scrivere» degli impegni. `email` è un testo
   * che Google accetta solo se è una mail.
   */
  kind: 'text' | 'paragraph' | 'choice' | 'list' | 'date' | 'time' | 'email'
  required: boolean
  choices?: readonly string[]
}

/** Le domande che il link precompilato scrive: gruppo, cantiere, codice del gruppo. */
export type Prefilled = 'group' | 'project' | 'code'

export type FormSpec<F extends string, P extends Prefilled = Prefilled> = {
  title: string
  description: string
  confirmation: string
  questions: readonly Question<F>[]
  /** Le domande precompilate, nell'ordine del link. */
  prefilled: readonly P[]
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
  prefilled: ['group', 'project', 'code'],
} satisfies FormSpec<UpdateField>

export type MeetingField = 'group' | 'code' | 'day' | 'time' | 'meet' | 'visible'

/** Il Modulo «Prossimo incontro» (T7): dal tasto «Aggiungi un incontro», con gruppo e codice del gruppo già scritti. */
export const MEETING_FORM = {
  title: 'Prossimo incontro',
  description:
    'Gruppo e codice del gruppo sono già scritti. Scrivi giorno, ora e link di Meet.\n\n' +
    `Come usiamo i dati: ${PRIVACY_URL}`,
  confirmation:
    'Grazie! L’incontro è arrivato. Sulla Bussola lo vedrai entro 10 minuti.\n\n' +
    `Torna alla Bussola: ${BUSSOLA_URL}`,
  questions: [
    { field: 'group', title: 'Gruppo', help: 'Già scritto: non cambiarlo.', kind: 'text', required: true },
    {
      field: 'code',
      title: 'Codice del gruppo: non cambiarlo',
      help: 'Serve alla Bussola per riconoscere il gruppo.',
      kind: 'text',
      required: true,
    },
    { field: 'day', title: 'Che giorno?', help: '', kind: 'date', required: true },
    { field: 'time', title: 'A che ora comincia?', help: '', kind: 'time', required: true },
    {
      field: 'meet',
      title: 'Il link di Meet',
      help: 'Comincia con https://meet.google.com/',
      kind: 'text',
      required: true,
    },
    {
      field: 'visible',
      title: 'È visibile ai soci?',
      help: 'Sì: compare sulla Bussola, per tutti i soci. No: lo vede solo chi rappresenta il gruppo.',
      kind: 'choice',
      required: true,
      choices: ['Sì', 'No'],
    },
  ] satisfies Question<MeetingField>[],
  prefilled: ['group', 'code'],
} satisfies FormSpec<MeetingField, 'group' | 'code'>

export type CommitmentField =
  | 'row'
  | 'what'
  | 'for'
  | 'days'
  | 'until'
  | 'term'
  | 'deliverables'
  | 'verifier'
  | 'pay'
  | 'fee'
  | 'feeVisible'
  | 'proposerFirstName'
  | 'proposerLastName'
  | 'proposer'
  | 'proposerEmail'
  | 'leave'
  | 'revoke'

/** La scelta dell'elenco quando non c'è nessuna riga «da scrivere»: Google vuole almeno una scelta. */
export const NO_COMMITMENT_ROW = 'Nessun impegno da scrivere: chiedi alla segreteria'

/** Sotto ogni testo libero: la lista ammessa ferma mail e telefoni, ma un nome non lo riconosce. */
const NO_NAMES = 'Non scrivere nomi, mail o telefoni di soci: questa scheda la leggono il Direttivo e il Coordinamento'

/**
 * Il Modulo «Proponi un impegno» (T6): si sceglie una riga «da scrivere», che la segreteria ha aggiunto quando il
 * Coordinamento ha detto che l'impegno serve, e si completa la scheda nei suoi sette blocchi. Niente codice: la riga
 * scelta è la chiave, e chi verifica e chi propone devono essere fra le Persone della Riservata. Chi propone scrive
 * anche nome, cognome e mail, che restano nel Foglio contenuti: non escono dal motore.
 */
export const COMMITMENT_FORM = {
  title: 'Proponi un impegno',
  description:
    'Scegli l’impegno da scrivere fra quelli preparati dalla segreteria e completa la scheda: sette blocchi, con un ' +
    'aiuto sotto ogni domanda. Poi la scheda va al Coordinamento e al Direttivo.\n\n' +
    `Come usiamo i dati: ${PRIVACY_URL}`,
  confirmation:
    'Grazie! La scheda è arrivata. Nella Riservata, in «Da approvare», la vedrai entro 10 minuti.\n\n' +
    `Torna alla Bussola: ${BUSSOLA_URL}/riservata`,
  questions: [
    {
      field: 'row',
      title: 'Quale impegno scrivi?',
      help:
        'Scegli la riga preparata dalla segreteria quando il Coordinamento ha detto che l’impegno serve. Se non ' +
        'c’è, chiedi alla segreteria di aggiungerla.',
      kind: 'list',
      required: true,
      choices: [NO_COMMITMENT_ROW],
    },
    // 1. Cosa si fa.
    {
      field: 'what',
      title: 'Cosa si fa?',
      help:
        'In due o tre frasi, il lavoro di chi prende l’impegno. Esempio: tiene in ordine i Fogli della Bussola. ' +
        `${NO_NAMES}, e dopo la ratifica si vede anche sul sito dei soci.`,
      kind: 'paragraph',
      required: true,
    },
    // 2. Per quale cantiere o GdL.
    {
      field: 'for',
      title: 'Per quale cantiere o GdL?',
      help: 'Il nome del GdL, o il cantiere col suo codice. Esempio: Comunicazione, oppure CAN-0004.',
      kind: 'text',
      required: true,
    },
    // 3. Quanto tempo, fino a quando, il tipo.
    {
      field: 'days',
      title: 'Quante giornate?',
      help: 'Le giornate di lavoro in tutto; vale anche la virgola. Esempio: 12, oppure 2,5.',
      kind: 'text',
      required: true,
    },
    {
      field: 'until',
      title: 'Fino a quando?',
      help: 'L’ultimo giorno dell’impegno. Se è continuativo, il giorno in cui lo si rivede.',
      kind: 'date',
      required: true,
    },
    {
      field: 'term',
      title: 'Di che tipo è?',
      help: 'Continuativo: va avanti nel tempo, come la cura di uno strumento. A progetto: finisce con una consegna.',
      kind: 'choice',
      required: true,
      choices: ['Continuativo', 'A progetto'],
    },
    // 4. Cosa si consegna e chi verifica.
    {
      field: 'deliverables',
      title: 'Cosa consegni?',
      help: `Cosa si potrà vedere alla fine, o a ogni scadenza. Esempio: un resoconto ogni tre mesi. ${NO_NAMES}.`,
      kind: 'paragraph',
      required: true,
    },
    {
      field: 'verifier',
      title: 'Chi verifica? Il numero socio',
      help:
        'Il numero socio di una persona delle Persone della Riservata (Direttivo, Coordinamento o segreteria), ' +
        'diversa da chi prende l’impegno.',
      kind: 'text',
      required: true,
    },
    // 5. Come si è pagati.
    {
      field: 'pay',
      title: 'Come vieni pagato o rimborsato?',
      help: 'Volontario: niente. Rimborso spese: solo le spese, con le ricevute. Compenso: una cifra per il lavoro.',
      kind: 'choice',
      required: true,
      choices: ['Volontario', 'Rimborso spese', 'Compenso'],
    },
    {
      field: 'fee',
      title: 'Quanto è il compenso, in euro?',
      help: 'Solo se hai scelto «Compenso»: la cifra in tutto. Esempio: 1.200.',
      kind: 'text',
      required: false,
    },
    {
      field: 'feeVisible',
      title: 'Il compenso si vede ai soci?',
      help:
        'Se non rispondi vale ciò che dice la segreteria nelle impostazioni, di solito «No». Con «No» i soci vedono ' +
        'il tipo e le giornate, ma non la cifra.',
      kind: 'choice',
      required: false,
      choices: ['Sì', 'No'],
    },
    // 6. Chi l'ha approvato: qui chi lo propone; le date della delibera e della ratifica le scrive la segreteria.
    {
      field: 'proposerFirstName',
      title: 'Chi lo propone? Il tuo nome',
      help:
        'Nome, cognome e mail restano nel Foglio della Bussola, che leggono la segreteria e chi cura la Bussola, ' +
        'per scriverti su questa scheda: sul sito e nella Riservata non escono.',
      kind: 'text',
      required: true,
    },
    {
      field: 'proposerLastName',
      title: 'Il tuo cognome',
      help: 'Come nel libro soci, così la segreteria ti ritrova.',
      kind: 'text',
      required: true,
    },
    {
      field: 'proposer',
      title: 'Il tuo numero socio',
      help:
        'Chi propone un impegno è fra le Persone della Riservata. Le date della delibera del Coordinamento e della ' +
        'ratifica del Direttivo le scrive la segreteria.',
      kind: 'text',
      required: true,
    },
    {
      field: 'proposerEmail',
      title: 'La tua mail',
      help: 'Quella a cui scriverti per questa scheda.',
      kind: 'email',
      required: true,
    },
    // 7. Se serve smettere.
    {
      field: 'leave',
      title: 'Se serve smettere: come si lascia?',
      help:
        'Con quanto preavviso, e a chi si passa il lavoro. Esempio: un mese prima, lasciando le istruzioni. ' +
        `${NO_NAMES}.`,
      kind: 'paragraph',
      required: true,
    },
    {
      field: 'revoke',
      title: 'E come si revoca?',
      help:
        'Chi può revocarlo, e come. Esempio: il Direttivo, sentito il Coordinamento, con una delibera. ' +
        `${NO_NAMES}.`,
      kind: 'paragraph',
      required: true,
    },
  ] satisfies Question<CommitmentField>[],
  prefilled: [],
} satisfies FormSpec<CommitmentField, never>

export type UpdateAnswer = Record<UpdateField, string>
export type MeetingAnswer = Record<MeetingField, string>
export type CommitmentAnswer = Record<CommitmentField, string>

export type FormResponse<A = UpdateAnswer> = { id: string; submittedAt: Date; answer: A }

const normalize = (title: string) => title.trim().toLowerCase()

/** Le risposte si riconoscono dal titolo della domanda; quelle che il motore non conosce si ignorano. */
export function answerFrom<F extends string>(
  spec: { questions: readonly Question<F>[] },
  items: { title: string; response: unknown }[],
): Record<F, string> {
  const answer = Object.fromEntries(spec.questions.map((question) => [question.field, ''])) as Record<F, string>
  for (const item of items) {
    const question = spec.questions.find((candidate) => normalize(candidate.title) === normalize(item.title))
    if (question && typeof item.response === 'string') answer[question.field] = item.response.trim()
  }
  return answer
}

export const answerFromItems = (items: { title: string; response: unknown }[]): UpdateAnswer =>
  answerFrom(UPDATE_FORM, items)

/** Le domande che un Modulo già creato non ha: nate dopo, la preparazione non le aggiunge da sé. */
export const missingQuestions = <F extends string>(
  spec: { questions: readonly Question<F>[] },
  titles: readonly string[],
): Question<F>[] =>
  spec.questions.filter((question) => !titles.some((title) => normalize(title) === normalize(question.title)))

/** I valori che la preparazione mette nel link di prova, per trovare le domande precompilate (`entry.<id>`). */
export const PREFILL_MARKERS: Record<Prefilled, string> = {
  group: 'BUSSOLAGRUPPO',
  project: 'BUSSOLACANTIERE',
  code: 'BUSSOLACODICE',
}

export type PrefillLinks<P extends Prefilled = Prefilled> = { base: string; entries: Record<P, string> }

/** Dal link di prova che dà Google (`toPrefilledUrl`): l'indirizzo del Modulo e le domande da precompilare. */
export function parsePrefilledUrl<P extends Prefilled = Prefilled>(
  url: string,
  spec: FormSpec<string, P> = UPDATE_FORM as unknown as FormSpec<string, P>,
): PrefillLinks<P> {
  const [base = '', query = ''] = url.split('?')
  const params = query.split('&')
  const entries = {} as Record<P, string>
  for (const field of spec.prefilled) {
    const param = params.find((candidate) => candidate.endsWith(`=${PREFILL_MARKERS[field]}`))
    if (!param) {
      const title = spec.questions.find((question) => question.field === field)?.title
      throw new Error(`Il Modulo «${spec.title}» è cambiato: il link precompilato non ha la domanda «${title}».`)
    }
    entries[field] = param.slice(0, param.indexOf('='))
  }
  return { base: `${base}?usp=pp_url`, entries }
}

export function prefilledUrl<P extends Prefilled>(links: PrefillLinks<P>, values: Partial<Record<P, string>>): string {
  let url = links.base
  for (const field of Object.keys(links.entries) as P[]) {
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

/** Una riga «da scrivere» nell'elenco del Modulo: il titolo e l'id, come per i cantieri. */
export const commitmentLabel = (commitment: { id: string; title: string }) => `${commitment.title} (${commitment.id})`

export function commitmentIdIn(answer: string): string | null {
  const ids = answer.match(/\bIMP-\d+\b/g)
  return ids ? (ids[ids.length - 1] ?? null) : null
}
