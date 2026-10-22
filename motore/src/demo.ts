// Il Foglio contenuti con dati inventati, con le date contate da oggi: lo usano i test e il KV locale delle E2E.
// Nessun dato vero di soci. I nomi nella colonna «referente» ci sono apposta: non devono uscire dal motore. È anche
// il contratto con le prove E2E della vetrina: scadenze, delibere, questioni e budget sono quelli che le prove cercano.
import { romeDate } from '@bussola/condiviso'
import { SHEETS } from './content.ts'
import { measureCells, MEASURES } from './measures.ts'

const DAY = 86_400_000
const HOUR = 3_600_000

export const DEMO_PREFILL_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdemo/viewform?usp=pp_url&entry.1001=BUSSOLAGRUPPO&entry.1002=BUSSOLACANTIERE&entry.1003=BUSSOLACODICE'

export const DEMO_EMAILS = {
  board: 'direttivo@example.org',
  rep: 'rappresentante.orti@example.org',
  office: 'segreteria@example.org',
  externalRep: 'esterno.semi@example.org',
  keeper: 'cura@example.org',
} as const

export const DEMO_CODES = {
  'GDL-orti': '6f1c2a9e0b7d4c3fa8e5d2b1c0a9f8e7',
  'GDL-semi': 'b4e7d1a2c9f84e0b9a1c7d3e5f2a6b8c',
  'GDL-formazione': '0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a',
  'GDL-comunicazione': 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
} as const

/** Le colonne di una scheda, nell'ordine dello spec, con i valori dati per nome. */
const row = (columns: readonly string[], values: Record<string, unknown>) => columns.map((name) => values[name] ?? '')

export function demoSheets(now: Date): Record<string, unknown[][]> {
  // Giorni di calendario a Roma, alla stessa ora: a 24 ore per giorno, nella settimana del cambio dell'ora e vicino
  // alla mezzanotte, «fra 31 giorni» cadeva a 30. Si sposta di un'ora verso il giorno giusto.
  const [year = 0, month = 1, day = 1] = romeDate(now).split('-').map(Number)
  const daysAgo = (days: number) => {
    const target = new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10)
    const date = new Date(now.getTime() - days * DAY)
    const seen = romeDate(date)
    return seen === target ? date : new Date(date.getTime() + (seen < target ? HOUR : -HOUR))
  }
  const groups = SHEETS.groups.columns
  const projects = SHEETS.projects.columns
  const people = SHEETS.people.columns
  const deadlines = SHEETS.deadlines.columns
  const resolutions = SHEETS.resolutions.columns
  const issues = SHEETS.issues.columns
  const budget = SHEETS.budget.columns
  const measures = SHEETS.measures.columns
  const deadline = (
    id: string,
    cosa: string,
    tipo: string,
    data: Date,
    owner: string,
    done: Date | '' = '',
  ): unknown[] => row(deadlines, { id, cosa, tipo, data, 'chi segue (ruolo)': owner, 'fatta il': done })
  const resolution = (
    id: string,
    data: Date,
    organo: string,
    oggetto: string,
    link: string,
    ratified: Date | '' = '',
  ) => row(resolutions, { id, data, organo, oggetto, 'link al verbale': link, 'ratificata il': ratified })
  const verbale = (n: string) => `https://drive.google.com/file/d/demo-verbale-${n}/view`
  return {
    [SHEETS.groups.name]: [
      [...groups],
      row(groups, { id: 'GDL-orti', nome: 'Orti e Suoli', 'codice del gruppo': DEMO_CODES['GDL-orti'] }),
      row(groups, { id: 'GDL-semi', nome: 'Semi e Biodiversità', 'codice del gruppo': DEMO_CODES['GDL-semi'] }),
      row(groups, { id: 'GDL-formazione', nome: 'Formazione', 'codice del gruppo': DEMO_CODES['GDL-formazione'] }),
      row(groups, {
        id: 'GDL-comunicazione',
        nome: 'Comunicazione',
        'codice del gruppo': DEMO_CODES['GDL-comunicazione'],
      }),
    ],
    [SHEETS.projects.name]: [
      [...projects],
      row(projects, {
        id: 'CAN-0001',
        GdL: 'GDL-orti',
        titolo: 'Rete dei mercati contadini',
        stato: 'in corso',
        'ultima novità': 'Abbiamo sentito sei produttori.',
        'prossimo passo': 'scegliere le tre date dei mercati di primavera',
        scadenza: daysAgo(-43),
        referente: 'Marta Bellini',
        'aggiornato il': daysAgo(3),
      }),
      row(projects, {
        id: 'CAN-0002',
        GdL: 'GDL-semi',
        titolo: 'Scambio di semi autunnale',
        stato: 'in corso',
        'ultima novità': 'La sala è quasi confermata.',
        'prossimo passo': 'confermare la sala',
        scadenza: daysAgo(10),
        'serve aiuto': 'Ci serve qualcuno che porti i tavoli.',
        'aggiornato il': daysAgo(20),
      }),
      row(projects, {
        id: 'CAN-0003',
        GdL: 'GDL-formazione',
        titolo: 'Corso sui suoli vivi',
        stato: 'in revisione',
        'ultima novità': 'Il programma è scritto.',
        'prossimo passo': 'far leggere il programma al Coordinamento',
        scadenza: daysAgo(-28),
        referente: 'Davide Russo',
        'aggiornato il': daysAgo(12),
      }),
      row(projects, {
        id: 'CAN-0004',
        GdL: 'GDL-comunicazione',
        titolo: 'Sito dei prodotti locali',
        stato: 'avvio',
        'ultima novità': 'Abbiamo un elenco di produttori.',
        'prossimo passo': 'decidere chi scrive le schede dei produttori',
        scadenza: daysAgo(-63),
        referente: 'Anna Ferri',
        'aggiornato il': daysAgo(41),
      }),
      row(projects, {
        id: 'CAN-0005',
        GdL: 'GDL-orti',
        titolo: 'Orto didattico',
        stato: 'chiuso',
        'ultima novità': 'Chiuso con la festa di fine estate.',
        'prossimo passo': '',
        'aggiornato il': daysAgo(50),
        'chiuso il': daysAgo(50),
      }),
    ],
    [SHEETS.updates.name]: [[...SHEETS.updates.columns]],
    // Un adempimento in ritardo, uno senza nessuno, uno fra 30 giorni e uno fra 31, uno fatto in ritardo (O7), un
    // bando scaduto e una misura.
    [SHEETS.deadlines.name]: [
      [...deadlines],
      deadline('SCA-0001', "Quota annuale all'ente di normazione", 'adempimento', daysAgo(5), 'il tesoriere'),
      deadline('SCA-0002', "Convocazione dell'Assemblea", 'Assemblea', daysAgo(-12), 'il segretario'),
      deadline('SCA-0003', 'Nomina per la piattaforma della newsletter', 'adempimento', daysAgo(-20), ''),
      deadline('SCA-0004', 'Bando regionale per la formazione', 'bando', daysAgo(-30), 'una persona di Formazione'),
      deadline('SCA-0005', 'Save the date del Raduno', 'evento', daysAgo(-31), 'il segretario'),
      deadline('SCA-0006', "Dichiarazione annuale dell'ente", 'fiscale', daysAgo(40), 'il tesoriere', daysAgo(38)),
      deadline('SCA-0007', 'Bando per i mercati contadini', 'bando', daysAgo(3), 'una persona di Orti e Suoli'),
      deadline(
        'SCA-0008',
        'Contare i messaggi senza risposta da più di 5 giorni',
        'misura',
        daysAgo(-6),
        'il segretario',
      ),
    ],
    // Una delibera senza verbale, una col verbale fra i Documenti, e l'ultima oltre i 12 mesi.
    [SHEETS.resolutions.name]: [
      [...resolutions],
      resolution(
        'DEL-01',
        daysAgo(10),
        'Coordinamento',
        'Calendario dei mercati di primavera',
        verbale('01'),
        daysAgo(3),
      ),
      resolution('DEL-02', daysAgo(40), 'Direttivo', 'Via alla prima versione della Bussola', verbale('02')),
      resolution('DEL-03', daysAgo(70), 'Direttivo', 'Spesa per il webinar sui suoli', ''),
      resolution(
        'DEL-04',
        daysAgo(120),
        'Assemblea',
        "Bilancio dell'anno passato",
        'https://docs.google.com/document/d/demo-verbale-04/edit',
      ),
      resolution('DEL-05', daysAgo(180), 'Direttivo', 'Incarichi a solo rimborso spese', verbale('05')),
      resolution('DEL-06', daysAgo(250), 'Direttivo', 'Fondo per i viaggi dei rappresentanti', verbale('06')),
      resolution('DEL-07', daysAgo(330), 'Direttivo', 'Ammissione dei nuovi soci', verbale('07')),
      resolution('DEL-08', daysAgo(400), 'Direttivo', 'Deleghe bancarie', verbale('08')),
    ],
    [SHEETS.issues.name]: [
      [...issues],
      row(issues, {
        id: 'QUE-01',
        cosa: 'Diritti dei soci sostenitori',
        'da quando': daysAgo(60),
        'chi (ruolo)': 'il Direttivo',
        stato: 'aperta',
      }),
      row(issues, {
        id: 'QUE-02',
        cosa: 'Codice etico per sponsorizzazioni e donazioni',
        'da quando': daysAgo(30),
        stato: 'aperta',
      }),
      row(issues, {
        id: 'QUE-03',
        cosa: 'Doppio tesseramento con altre associazioni',
        'da quando': daysAgo(90),
        'chi (ruolo)': 'il tesoriere',
      }),
      row(issues, {
        id: 'QUE-04',
        cosa: 'Service audio e video del Raduno',
        'da quando': daysAgo(45),
        'chi (ruolo)': 'il segretario',
        stato: 'chiusa',
      }),
    ],
    [SHEETS.budget.name]: [
      [...budget],
      row(budget, { voce: 'Ciclo webinar e corsi', previsto: 5000, speso: 1200, 'aggiornato il': daysAgo(20) }),
      row(budget, { voce: 'Sito web', previsto: 500, speso: 500, 'aggiornato il': daysAgo(9) }),
      row(budget, { voce: 'Raduno di Cervia', previsto: 4771.5, speso: 4210, 'aggiornato il': daysAgo(9) }),
    ],
    [SHEETS.people.name]: [
      [...people],
      row(people, { id: 'PER-01', mail: DEMO_EMAILS.board, 'numero socio': 12, ruoli: 'Direttivo' }),
      row(people, {
        id: 'PER-02',
        mail: DEMO_EMAILS.rep,
        'numero socio': 34,
        ruoli: 'rappresentante',
        GdL: 'GDL-orti',
      }),
      row(people, { id: 'PER-03', mail: DEMO_EMAILS.office, ruoli: 'segreteria' }),
      row(people, { id: 'PER-04', mail: DEMO_EMAILS.externalRep, ruoli: 'rappresentante', GdL: 'GDL-semi' }),
      row(people, { id: 'PER-05', mail: DEMO_EMAILS.keeper, ruoli: 'cura della Bussola, Direttivo' }),
    ],
    // Senza formule in «variazione»: è un Foglio finto, e il motore la scheda non la legge.
    [SHEETS.measures.name]: [[...measures], ...MEASURES.map((measure) => row(measures, measureCells(measure)))],
    [SHEETS.settings.name]: [[...SHEETS.settings.columns], ['giorni per fermo', 30]],
    [SHEETS.health.name]: [[...SHEETS.health.columns]],
  }
}
