// Gli attrezzi delle prove della vetrina: le chiavi di Access finte, il KV finto e un'istantanea riservata con date
// contate da oggi. Non entra nella Function: la importano solo i test.
import { romeDate, type Deadline, type ReservedSnapshot } from '@bussola/condiviso'
import { sign } from 'hono/jwt'
import { vi } from 'vitest'

export const TEAM = 'rami.cloudflareaccess.com'
export const AUD = 'aud-di-prova'

export const EMAILS = {
  rep: 'rappresentante.orti@example.org',
  board: 'direttivo@example.org',
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

export function testEnv(values: Record<string, unknown> = {}, aud = AUD) {
  const BUSSOLA = { get: async (key: string) => values[key] ?? null } as unknown as KVNamespace
  return { BUSSOLA, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: aud }
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
      { id: 'GDL-comunicazione', name: 'Comunicazione', newProjectUrl: link('Comunicazione', 'k-com') },
      { id: 'GDL-orti', name: 'Orti e Suoli', newProjectUrl: link('Orti e Suoli', 'k-orti') },
      { id: 'GDL-semi', name: 'Semi e Biodiversità', newProjectUrl: link('Semi e Biodiversità', 'k-semi') },
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
  }
}
