// Gli attrezzi delle prove della vetrina: le chiavi di Access finte, il KV finto e le istantanee, riservata e del
// sito, con date contate da oggi. Non entra nella Function: la importano solo i test.
import {
  MEMBERS_KEY,
  RESERVED_KEY,
  romeDate,
  SITE_KEY,
  type Deadline,
  type MembersSnapshot,
  type ReservedCommitment,
  type ReservedSnapshot,
  type SiteLink,
  type SiteSnapshot,
} from '@bussola/condiviso'
import { sign } from 'hono/jwt'
import { vi } from 'vitest'
import { sha256Hex } from './identity.ts'

export const TEAM = 'rami.cloudflareaccess.com'
export const AUD = 'aud-di-prova'

export const EMAILS = {
  rep: 'rappresentante.orti@example.org',
  board: 'direttivo@example.org',
  office: 'segreteria@example.org',
  keeper: 'cura@example.org',
  outsider: 'nessuno@example.org',
} as const

let privateJwk: JsonWebKey & { kid: string }

/** Una chiave di prova al posto di quelle del team: il JWT si firma qui, la chiave pubblica arriva da un fetch finto. */
export async function useAccessKeys() {
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }
  const pair = (await crypto.subtle.generateKey({ ...algorithm, hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  privateJwk = { ...((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey), kid: 'prova' }
  const publicJwk = {
    ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey),
    kid: 'prova',
    alg: 'RS256',
  }
  vi.stubGlobal('fetch', async (url: string) =>
    url === `https://${TEAM}/cdn-cgi/access/certs`
      ? Response.json({ keys: [publicJwk] })
      : new Response('', { status: 404 }),
  )
}

export const accessJwt = (claims: Record<string, unknown> = {}) =>
  sign(
    {
      iss: `https://${TEAM}`,
      aud: [AUD],
      email: EMAILS.board,
      exp: Math.floor(Date.now() / 1000) + 600,
      ...claims,
    },
    privateJwk,
    'RS256',
  )

export type MemoryKvNamespace = KVNamespace & {
  /** Il valore e la scadenza in secondi di ogni chiave. */
  store: Map<string, { value: string; ttl: number | null }>
  puts: string[]
}

/** Un KV in memoria, con `get` e `put` come quelli di Workers: quello che serve alla vetrina. */
export function memoryKvNamespace(values: Record<string, unknown> = {}): MemoryKvNamespace {
  const store = new Map(
    Object.entries(values).map(([key, value]) => [
      key,
      { value: typeof value === 'string' ? value : JSON.stringify(value), ttl: null as number | null },
    ]),
  )
  const puts: string[] = []
  const kv = {
    store,
    puts,
    async get(key: string, type?: string) {
      const item = store.get(key)
      if (!item) return null
      return type === 'json' ? JSON.parse(item.value) : item.value
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, { value, ttl: options?.expirationTtl ?? null })
      puts.push(key)
    },
  }
  return kv as unknown as MemoryKvNamespace
}

export function testEnv(values: Record<string, unknown> = {}, aud = AUD, kv = memoryKvNamespace(values)) {
  return { BUSSOLA: kv as KVNamespace, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: aud }
}

/**
 * Il giorno di Roma di `days` giorni fa (negativo: nel futuro), contati sul calendario: a 24 ore per giorno, nella
 * settimana del cambio dell'ora e dopo mezzanotte, «fra 31 giorni» cadeva a 30 e le prove delle scadenze andavano in
 * rosso.
 */
export const daysAgo = (days: number) => {
  const [year = 0, month = 1, day = 1] = romeDate(new Date()).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10)
}

const FORM = 'https://docs.google.com/forms/d/e/prova/viewform?usp=pp_url'
const link = (group: string, code: string, project?: string) =>
  `${FORM}&entry.1=${encodeURIComponent(group)}${project ? `&entry.2=${encodeURIComponent(project)}` : ''}&entry.3=${code}`
const meetingLink = (group: string, code: string) =>
  `https://docs.google.com/forms/d/e/incontro/viewform?usp=pp_url&entry.4=${encodeURIComponent(group)}&entry.5=${code}`

/** Giorno e ora di Roma fra `days` giorni. */
export const at = (days: number, time: string) => `${daysAgo(-days)}T${time}`

export const MEET = {
  ortiInternal: 'https://meet.google.com/orti-solo-gruppo',
  orti: 'https://meet.google.com/orti-aperto-soci',
  semi: 'https://meet.google.com/semi-aperto-soci',
  coordination: 'https://meet.google.com/coordinamento-prova',
} as const

const deadline = (fields: Partial<Deadline> & { id: string; what: string; dueOn: string }): Deadline => ({
  kind: 'duty',
  ownerRole: 'il tesoriere',
  doneOn: null,
  ...fields,
})

const resolution = (
  days: number,
  body: string,
  subject: string,
  fields: Partial<ReservedSnapshot['resolutions'][number]> = {},
) => ({
  date: daysAgo(days),
  body,
  subject,
  minutesUrl: `https://drive.google.com/file/d/verbale-${days}/view`,
  ratifiedOn: null,
  ...fields,
})

/** Un impegno della Riservata: la scheda vuota, coi campi dati. */
export const commitment = (
  fields: Partial<ReservedCommitment> & Pick<ReservedCommitment, 'id' | 'title' | 'status'>,
): ReservedCommitment => ({
  year: Number(daysAgo(0).slice(0, 4)),
  outcome: null,
  rejectionReason: '',
  what: '',
  forLabel: 'Comunicazione',
  groupId: 'GDL-comunicazione',
  days: null,
  until: null,
  term: null,
  deliverables: '',
  verifierNumber: null,
  pay: null,
  fee: null,
  feeVisible: false,
  proposedBy: null,
  proposedOn: null,
  coordinationOn: null,
  ratifiedOn: null,
  howToLeave: '',
  howToRevoke: '',
  assigneeNumber: null,
  assigneeRole: '',
  substituteNumber: null,
  planned: null,
  spent: null,
  ...fields,
})

export const COMMITMENT_FORM_URL = 'https://docs.google.com/forms/d/e/impegno/viewform'

/**
 * I sette impegni dell'anno dei criteri di T6: uno da scrivere, uno proposto (pagato prima della ratifica), uno
 * respinto, uno aperto, uno preso, uno chiuso completato e uno chiuso ritirato.
 */
export const commitmentsFixture = (): ReservedCommitment[] => [
  commitment({ id: 'IMP-0001', title: 'La cura della Bussola', status: 'toWrite' }),
  commitment({
    id: 'IMP-0002',
    title: 'Tesseramento online',
    status: 'proposed',
    what: 'Preparare il modulo di iscrizione online e seguirne il primo anno.',
    days: 8,
    until: daysAgo(-120),
    term: 'project',
    deliverables: 'Il modulo di iscrizione, provato con dieci soci.',
    verifierNumber: '12',
    pay: 'paid',
    fee: 800,
    proposedBy: '34',
    proposedOn: daysAgo(6),
    howToLeave: 'Con due settimane di preavviso.',
    howToRevoke: 'Il Direttivo, con una delibera.',
    planned: 800,
    spent: 200,
  }),
  commitment({
    id: 'IMP-0003',
    title: 'Stand alla fiera regionale',
    status: 'rejected',
    proposedOn: daysAgo(25),
    rejectionReason: 'Il Coordinamento preferisce aspettare il bando di primavera.',
  }),
  commitment({
    id: 'IMP-0004',
    title: 'Mappa dei semenzai',
    status: 'open',
    forLabel: 'Orti e Suoli',
    groupId: 'GDL-orti',
    days: 5,
    term: 'project',
    pay: 'volunteer',
    ratifiedOn: daysAgo(30),
  }),
  commitment({
    id: 'IMP-0005',
    title: 'Banco dei semi agli scambi',
    status: 'taken',
    forLabel: 'Semi e Biodiversità',
    groupId: 'GDL-semi',
    days: 6,
    term: 'ongoing',
    pay: 'expenses',
    ratifiedOn: daysAgo(60),
    assigneeNumber: '34',
    assigneeRole: 'una persona di Semi e Biodiversità',
  }),
  commitment({
    id: 'IMP-0006',
    title: 'Logistica del Raduno',
    status: 'closed',
    outcome: 'completed',
    ratifiedOn: daysAgo(150),
    assigneeNumber: '34',
  }),
  commitment({
    id: 'IMP-0007',
    title: 'Video dei webinar',
    status: 'closed',
    outcome: 'withdrawn',
    ratifiedOn: daysAgo(120),
  }),
]

export function reservedFixture(): ReservedSnapshot {
  // L'anno di oggi: la scadenza fatta in ritardo ci deve stare dentro, anche a gennaio.
  const year = daysAgo(0).slice(0, 4)
  const project = (fields: Partial<ReservedSnapshot['projects'][number]> & { id: string; title: string }) => ({
    groupId: 'GDL-orti',
    stage: 'ongoing' as const,
    lastNews: 'Abbiamo sentito sei produttori.',
    nextStep: 'scegliere le date',
    dueOn: daysAgo(-40),
    updatedOn: daysAgo(0),
    helpWanted: '',
    updateUrl: link('Orti e Suoli', 'k-orti', `${fields.title} (${fields.id})`),
    ...fields,
  })
  return {
    version: 1,
    publishedAt: '2026-10-18T19:40:00.000Z',
    staleDays: 30,
    groups: [
      {
        id: 'GDL-comunicazione',
        name: 'Comunicazione',
        newProjectUrl: link('Comunicazione', 'k-com'),
        newMeetingUrl: meetingLink('Comunicazione', 'k-com'),
      },
      {
        id: 'GDL-orti',
        name: 'Orti e Suoli',
        newProjectUrl: link('Orti e Suoli', 'k-orti'),
        newMeetingUrl: meetingLink('Orti e Suoli', 'k-orti'),
      },
      {
        id: 'GDL-semi',
        name: 'Semi e Biodiversità',
        newProjectUrl: link('Semi e Biodiversità', 'k-semi'),
        newMeetingUrl: meetingLink('Semi e Biodiversità', 'k-semi'),
      },
    ],
    projects: [
      project({ id: 'CAN-0001', title: 'Rete dei mercati contadini' }),
      project({
        id: 'CAN-0002',
        title: 'Scambio di semi autunnale',
        groupId: 'GDL-semi',
        dueOn: daysAgo(10),
        updatedOn: daysAgo(20),
        helpWanted: 'Ci serve qualcuno che porti i tavoli.',
        updateUrl: link('Semi e Biodiversità', 'k-semi', 'Scambio di semi autunnale (CAN-0002)'),
      }),
      project({ id: 'CAN-0003', title: 'Orto condiviso', stage: 'review', dueOn: null, updatedOn: daysAgo(29) }),
      project({
        id: 'CAN-0004',
        title: 'Sito dei prodotti locali',
        groupId: 'GDL-comunicazione',
        stage: 'start',
        dueOn: daysAgo(-60),
        updatedOn: daysAgo(30),
        updateUrl: link('Comunicazione', 'k-com', 'Sito dei prodotti locali (CAN-0004)'),
      }),
    ],
    people: [
      {
        fingerprint: '46924aed7eae820222d4533b6da5cc8fbfbfb3f96d706965d8b3caa966a2a535',
        memberNumber: '34',
        roles: ['rep'],
        groupId: 'GDL-orti',
      },
      {
        fingerprint: '070fe12ea53b8b0fd3527700f2ff8122aaeb6860151ce291595ec753d4a311d1',
        memberNumber: '12',
        roles: ['board'],
        groupId: null,
      },
    ],
    // Le scadenze: un adempimento in ritardo, tre nei prossimi 30 giorni (una senza nessuno), una misura passata;
    // fuori dalla lista una a 31 giorni, un bando scaduto e due fatte, una delle quali in ritardo (O7).
    deadlines: [
      deadline({ id: 'SCA-0001', what: 'Quota annuale all’ente di normazione', dueOn: daysAgo(5) }),
      deadline({ id: 'SCA-0002', what: 'Convocazione dell’Assemblea', kind: 'assembly', dueOn: daysAgo(-12) }),
      deadline({
        id: 'SCA-0003',
        what: 'Nomina per la piattaforma della newsletter',
        kind: 'call',
        dueOn: daysAgo(-20),
        ownerRole: '',
      }),
      deadline({
        id: 'SCA-0004',
        what: 'Bando regionale per la formazione',
        kind: 'call',
        dueOn: daysAgo(-30),
        ownerRole: 'una persona di Struttura',
      }),
      deadline({ id: 'SCA-0005', what: 'Save the date del Raduno', kind: 'event', dueOn: daysAgo(-31) }),
      deadline({
        id: 'SCA-0006',
        what: 'Versamento delle ritenute',
        kind: 'tax',
        dueOn: `${year}-01-16`,
        doneOn: `${year}-01-20`,
      }),
      deadline({ id: 'SCA-0007', what: 'Bando per i mercati contadini', kind: 'call', dueOn: daysAgo(3) }),
      deadline({
        id: 'SCA-0008',
        what: 'Contare i messaggi senza risposta',
        kind: 'measure',
        dueOn: daysAgo(4),
        ownerRole: 'il segretario',
      }),
      deadline({ id: 'SCA-0009', what: 'Rinnovo dell’assicurazione', dueOn: daysAgo(-10), doneOn: daysAgo(1) }),
    ],
    // Sette delibere negli ultimi 12 mesi, in disordine; quella di 400 giorni fa resta fuori.
    resolutions: [
      resolution(40, 'Direttivo', 'Spesa per il webinar sui suoli', { minutesUrl: null }),
      resolution(10, 'Coordinamento', 'Calendario dei mercati di primavera', { ratifiedOn: daysAgo(4) }),
      resolution(400, 'Direttivo', 'Deleghe bancarie'),
      resolution(60, 'Direttivo', 'Quote associative'),
      resolution(90, 'Assemblea', 'Bilancio preventivo'),
      resolution(120, 'Direttivo', 'Adesione alla campagna sui semi'),
      resolution(200, 'Coordinamento', 'Regolamento dei gruppi di lavoro'),
      resolution(300, 'Direttivo', 'Apertura del conto per le donazioni'),
    ],
    issues: [
      { what: 'Diritti dei soci sostenitori', since: daysAgo(50), ownerRole: 'una persona del Direttivo' },
      { what: 'Codice etico per sponsorizzazioni e donazioni', since: daysAgo(20), ownerRole: '' },
      { what: 'Doppio tesseramento con altre associazioni', since: null, ownerRole: 'il segretario' },
    ],
    budget: {
      updatedOn: daysAgo(9),
      lines: [
        { label: 'Ciclo webinar e corsi', planned: 5000, spent: 1200 },
        { label: 'Sito web', planned: 500, spent: 500 },
        { label: 'Raduno di Cervia', planned: 4771.5, spent: 4210 },
      ],
    },
    // Del gruppo Orti uno solo per il gruppo, fra 3 giorni, e uno aperto ai soci fra 7; uno del Coordinamento.
    meetings: [
      { groupId: 'Coordinamento', startsAt: at(2, '21:00'), meetUrl: MEET.coordination, membersCanSee: false },
      { groupId: 'GDL-orti', startsAt: at(3, '18:30'), meetUrl: MEET.ortiInternal, membersCanSee: false },
      { groupId: 'GDL-orti', startsAt: at(7, '18:30'), meetUrl: MEET.orti, membersCanSee: true },
      { groupId: 'GDL-semi', startsAt: at(10, '18:00'), meetUrl: MEET.semi, membersCanSee: true },
    ],
    commitments: commitmentsFixture(),
    commitmentFormUrl: COMMITMENT_FORM_URL,
  }
}

export const OFFICE_URL = 'https://docs.google.com/forms/d/e/segreteria/viewform'

/** L'istantanea del sito: i gruppi, gli incontri visibili ai soci, i link, le scadenze dei soci, il primo giorno. */
export function siteFixture(): SiteSnapshot {
  return {
    version: 1,
    publishedAt: '2026-10-18T19:40:00.000Z',
    officeUrl: OFFICE_URL,
    groups: [
      {
        id: 'GDL-comunicazione',
        name: 'Comunicazione',
        mission: 'Raccontare la rete: sito, newsletter e social.',
        howToJoin: 'Scrivi alla segreteria.',
        whereWhen: 'Online, il primo lunedì del mese.',
        chatUrl: null,
        referents: [],
      },
      {
        id: 'GDL-orti',
        name: 'Orti e Suoli',
        mission: 'Mettere in rete gli orti dei soci e imparare insieme a curare il suolo.',
        howToJoin: 'Vieni a un incontro online: non serve iscriversi.',
        whereWhen: 'Online, un giovedì al mese alle 18:30.',
        chatUrl: 'https://chat.example.org/orti-e-suoli',
        referents: [
          { name: 'Lia Prova', role: 'referente' },
          { name: null, role: 'co-referente' },
        ],
      },
      {
        id: 'GDL-semi',
        name: 'Semi e Biodiversità',
        mission: 'Custodire e scambiare i semi delle varietà locali.',
        howToJoin: 'Scrivi alla segreteria: ti presentiamo al gruppo.',
        whereWhen: 'Online ogni due settimane, e in presenza agli scambi di semi.',
        chatUrl: null,
        referents: [{ name: 'Teo Finto', role: 'referente' }],
      },
    ],
    meetings: [
      { groupId: 'GDL-orti', startsAt: at(7, '18:30'), meetUrl: MEET.orti },
      { groupId: 'GDL-semi', startsAt: at(10, '18:00'), meetUrl: MEET.semi },
    ],
    links: [
      { title: 'Calendario degli incontri', url: 'https://calendar.example.org/rami', audience: 'all', groupId: null },
      {
        title: 'Modulo per proporre un evento',
        url: 'https://docs.google.com/forms/d/e/evento/viewform',
        audience: 'members',
        groupId: null,
      },
      {
        title: 'Cartella dei semenzai',
        url: 'https://drive.google.com/drive/folders/orti',
        audience: 'group',
        groupId: 'GDL-orti',
      },
      {
        title: 'Verbali del Coordinamento',
        url: 'https://drive.google.com/drive/folders/coordinamento',
        audience: 'coordination',
        groupId: null,
      },
    ],
    // Una a 12 giorni, una a 90, una a 91 (fuori) e una passata, che il motore non manda ma la pagina sa scartare.
    deadlines: [
      { id: 'SCA-0099', what: 'Iscrizioni al corso chiuse', kind: 'event', dueOn: daysAgo(1) },
      { id: 'SCA-0002', what: 'Convocazione dell’Assemblea', kind: 'assembly', dueOn: daysAgo(-12) },
      { id: 'SCA-0011', what: 'Raduno di primavera', kind: 'event', dueOn: daysAgo(-90) },
      { id: 'SCA-0012', what: 'Assemblea dei soci di primavera', kind: 'assembly', dueOn: daysAgo(-91) },
    ],
    firstDay: [
      { title: 'Scegli un gruppo', text: 'Guarda i Gruppi: ognuno dice cosa fa e come si partecipa.', url: null },
      { title: 'Vieni a un incontro', text: 'Il prossimo incontro di ogni gruppo è sulla sua pagina.', url: null },
      {
        title: 'Guarda il calendario',
        text: 'Tutti gli incontri, in un posto.',
        url: 'https://calendar.example.org/rami',
      },
    ],
    commitments: [],
  }
}

/** I numeri dei soci (da T4), con la riga dei rinnovi come in febbraio. */
export function membersFixture(): MembersSnapshot {
  return {
    version: 1,
    publishedAt: '2026-10-18T19:40:00.000Z',
    asOf: daysAgo(0),
    counts: { inGoodStanding: 150, paidAhead: 3, dueForRenewal: 110, notInGoodStanding: 7, left: 12, members: 270 },
    renewals: { year: 2027, renewed: 150, base: 260, percent: 58, until: '03-31' },
  }
}

/** La cartella di un secondo GdL, oltre a quella di Orti e Suoli: per provare chi trova quale indirizzo. */
export const SEMI_FOLDER: SiteLink = {
  title: 'Cartella dei semi',
  url: 'https://drive.google.com/drive/folders/semi',
  audience: 'group',
  groupId: 'GDL-semi',
}

/** L'istantanea riservata con anche la segreteria (EMAILS.office): entra, ma non è di un GdL né del Coordinamento. */
export async function reservedWithOffice(): Promise<ReservedSnapshot> {
  const snapshot = reservedFixture()
  const office = {
    fingerprint: await sha256Hex(EMAILS.office),
    memberNumber: null,
    roles: ['office' as const],
    groupId: null,
  }
  return { ...snapshot, people: [...snapshot.people, office] }
}

/** Una pagina chiesta in locale come la persona con quella mail, con le tre istantanee in un KV finto. */
export async function requestPage(
  path: string,
  email?: string,
  data: { reserved?: ReservedSnapshot | null; site?: SiteSnapshot | null; members?: MembersSnapshot | null } = {},
  kv?: MemoryKvNamespace,
) {
  const { default: app } = await import('./index.tsx')
  const reserved = data.reserved === undefined ? reservedFixture() : data.reserved
  const site = data.site === undefined ? siteFixture() : data.site
  const members = data.members === undefined ? membersFixture() : data.members
  const values = {
    ...(reserved && { [RESERVED_KEY]: reserved }),
    ...(site && { [SITE_KEY]: site }),
    ...(members && { [MEMBERS_KEY]: members }),
  }
  const store = kv ?? memoryKvNamespace()
  for (const [key, value] of Object.entries(values)) store.store.set(key, { value: JSON.stringify(value), ttl: null })
  const res = await app.request(
    `http://localhost:8788${path}`,
    { headers: email ? { 'X-Bussola-Prova-Mail': email } : {} },
    testEnv(values, AUD, store),
  )
  return { res, html: await res.text() }
}

/** Il testo di una pagina, senza i tag: per cercare le frasi come le legge una persona. */
export const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
