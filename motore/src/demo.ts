// Il Foglio contenuti con dati inventati, con le date contate da oggi: lo usano i test e il KV locale delle E2E.
// Nessun dato vero di soci. I nomi nella colonna «referente» ci sono apposta: non devono uscire dal motore. Nella
// scheda «Referenti» due nomi hanno il consenso e due no, e le mail ci sono apposta: dal sito escono solo i primi due.
// È anche il contratto con le prove E2E della vetrina: scadenze, delibere, questioni, budget, gruppi, incontri, link e
// primo giorno sono quelli che le prove cercano.
import { romeDate } from '@bussola/condiviso'
import { SHEETS } from './content.ts'
import type { CommitmentAnswer } from './form.ts'
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

/** I referenti della scheda «Referenti»: col consenso escono nome e ruolo, senza solo il ruolo. */
export const DEMO_REFERENTS = {
  withConsent: ['Lia Prova', 'Teo Finto'],
  withoutConsent: ['Bruno Esempio', 'Nina Demo'],
  emails: ['lia.prova@example.org', 'bruno.esempio@example.org', 'teo.finto@example.org', 'nina.demo@example.org'],
} as const

export const DEMO_MEET = {
  ortiInternal: 'https://meet.google.com/orti-solo-gruppo',
  orti: 'https://meet.google.com/orti-aperto-soci',
  coordination: 'https://meet.google.com/coordinamento-prova',
  semi: 'https://meet.google.com/semi-aperto-soci',
  later: 'https://meet.google.com/formazione-fra-70-giorni',
} as const

export const DEMO_MEETING_PREFILL_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSincontro/viewform?usp=pp_url&entry.2001=BUSSOLAGRUPPO&entry.2002=BUSSOLACODICE'

export const DEMO_OFFICE_URL = 'https://docs.google.com/forms/d/e/demo-segreteria/viewform'

export const DEMO_COMMITMENT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSimpegno/viewform'

/**
 * Una prima stesura della scheda «La cura della Bussola», l'impegno di chi cura la piattaforma, per provare il Modulo
 * «Proponi un impegno»: plausibile, ma di prova. Completa la riga «da scrivere» IMP-0001. Il compenso visibile ai
 * soci resta senza risposta: vale il «no» di «Impostazioni».
 */
export const DEMO_COMMITMENT_ANSWER: CommitmentAnswer = {
  row: 'La cura della Bussola (IMP-0001)',
  what:
    'Bozza di prova. Tenere in ordine i Fogli della Bussola, guardare «Salute» ogni settimana, rispondere alle ' +
    'domande dei rappresentanti e preparare le versioni nuove con il Coordinamento.',
  for: 'Comunicazione',
  days: '12',
  until: '2027-06-30',
  term: 'Continuativo',
  deliverables: 'Bozza di prova. Un resoconto ogni tre mesi al Coordinamento, con le misure della scheda «Misure».',
  verifier: '12',
  pay: 'Compenso',
  fee: '1.200',
  feeVisible: '',
  proposerFirstName: 'Ada',
  proposerLastName: 'Fittizia',
  proposer: '34',
  proposerEmail: 'ada.fittizia@example.org',
  leave: 'Bozza di prova. Con un mese di preavviso, lasciando le istruzioni scritte a chi subentra.',
  revoke: 'Bozza di prova. Il Direttivo, sentito il Coordinamento, con una delibera e un mese di preavviso.',
}

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
  const referents = SHEETS.referents.columns
  const meetings = SHEETS.meetings.columns
  const links = SHEETS.links.columns
  const firstDay = SHEETS.firstDay.columns
  const commitments = SHEETS.commitments.columns
  const commitment = (values: Record<string, unknown>) => row(commitments, { anno: year, ...values })
  /** «AAAA-MM-GG HH:MM» del giorno di Roma fra `days` giorni, come lo scrive una persona. */
  const at = (days: number, time: string) => `${romeDate(daysAgo(-days))} ${time}`
  const deadline = (
    id: string,
    cosa: string,
    tipo: string,
    data: Date,
    owner: string,
    done: Date | '' = '',
  ): unknown[] => row(deadlines, { id, cosa, tipo, data, 'chi segue (ruolo)': owner, 'fatta il': done })
  /** La stessa scadenza, «visibile ai soci». */
  const forMembers = (cells: unknown[]) => cells.map((cell, i) => (deadlines[i] === 'visibile ai soci' ? 'sì' : cell))
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
      row(groups, {
        id: 'GDL-orti',
        nome: 'Orti e Suoli',
        missione: 'Mettere in rete gli orti dei soci e imparare insieme a curare il suolo.',
        'come si partecipa': 'Vieni a un incontro online: non serve iscriversi.',
        'dove e quando': 'Online, un giovedì al mese alle 18:30.',
        'link della chat': 'https://chat.example.org/orti-e-suoli',
        'chat aperta ai soci': 'sì',
        'codice del gruppo': DEMO_CODES['GDL-orti'],
      }),
      row(groups, {
        id: 'GDL-semi',
        nome: 'Semi e Biodiversità',
        missione: 'Custodire e scambiare i semi delle varietà locali.',
        'come si partecipa': 'Scrivi alla segreteria: ti presentiamo al gruppo.',
        'dove e quando': 'Online ogni due settimane, e in presenza agli scambi di semi.',
        'link della chat': 'https://chat.example.org/semi-solo-partecipanti',
        'chat aperta ai soci': 'no',
        'codice del gruppo': DEMO_CODES['GDL-semi'],
      }),
      row(groups, {
        id: 'GDL-formazione',
        nome: 'Formazione',
        missione: 'Organizzare corsi e webinar per i soci.',
        'come si partecipa': 'Proponi un tema o dai una mano a organizzare un corso.',
        'dove e quando': 'Online, quando c’è un corso da preparare.',
        'codice del gruppo': DEMO_CODES['GDL-formazione'],
      }),
      row(groups, {
        id: 'GDL-comunicazione',
        nome: 'Comunicazione',
        missione: 'Raccontare la rete: sito, newsletter e social.',
        'come si partecipa': 'Scrivi alla segreteria.',
        'dove e quando': 'Online, il primo lunedì del mese.',
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
    // bando scaduto e una misura. Visibili ai soci: due nei prossimi 30 giorni, uno fra 90 e uno fra 91.
    [SHEETS.deadlines.name]: [
      [...deadlines],
      deadline('SCA-0001', "Quota annuale all'ente di normazione", 'adempimento', daysAgo(5), 'il tesoriere'),
      forMembers(deadline('SCA-0002', "Convocazione dell'Assemblea", 'Assemblea', daysAgo(-12), 'il segretario')),
      deadline('SCA-0003', 'Nomina per la piattaforma della newsletter', 'adempimento', daysAgo(-20), ''),
      deadline('SCA-0004', 'Bando regionale per la formazione', 'bando', daysAgo(-30), 'una persona di Formazione'),
      forMembers(deadline('SCA-0005', 'Save the date del Raduno', 'evento', daysAgo(-31), 'il segretario')),
      deadline('SCA-0006', "Dichiarazione annuale dell'ente", 'fiscale', daysAgo(40), 'il tesoriere', daysAgo(38)),
      deadline('SCA-0007', 'Bando per i mercati contadini', 'bando', daysAgo(3), 'una persona di Orti e Suoli'),
      deadline(
        'SCA-0008',
        'Contare i messaggi senza risposta da più di 5 giorni',
        'misura',
        daysAgo(-6),
        'il segretario',
      ),
      forMembers(deadline('SCA-0009', 'Raduno di primavera', 'evento', daysAgo(-90), 'il segretario')),
      forMembers(deadline('SCA-0010', 'Assemblea dei soci di primavera', 'Assemblea', daysAgo(-91), 'il segretario')),
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
      // Due impegni: uno pagato prima della ratifica, «Compenso senza scheda approvata».
      row(budget, { voce: 'Tesseramento online (IMP-0003)', previsto: 800, speso: 200, 'aggiornato il': daysAgo(9) }),
      row(budget, { voce: 'Verbali del Coordinamento', previsto: 600, speso: 300, 'aggiornato il': daysAgo(9) }),
    ],
    // Due da scrivere (il primo lo completa il Modulo di prova), uno proposto, uno che aspetta il Direttivo, uno
    // respinto, uno aperto, uno preso, uno in corso col compenso nascosto, uno chiuso completato e uno ritirato. Il
    // nome nelle «note», e nome, cognome e mail di chi ha proposto IMP-0003, ci sono apposta: non devono uscire dal
    // motore.
    [SHEETS.commitments.name]: [
      [...commitments],
      commitment({
        id: 'IMP-0001',
        titolo: 'La cura della Bussola',
        stato: 'da scrivere',
        note: 'Sentire Ugo Fittizio',
      }),
      commitment({ id: 'IMP-0002', titolo: 'La newsletter del mese', stato: 'da scrivere' }),
      commitment({
        id: 'IMP-0003',
        titolo: 'Tesseramento online',
        'cosa si fa': 'Preparare il modulo di iscrizione online e seguirne il primo anno.',
        'cantiere o GdL': 'Comunicazione',
        giornate: 8,
        'fino a quando': daysAgo(-120),
        tipo: 'a progetto',
        consegne: 'Il modulo di iscrizione, provato con dieci soci.',
        'chi verifica (numero socio)': 12,
        retribuzione: 'compenso',
        compenso: 800,
        'proposto da (numero socio)': 34,
        'proposto da (nome)': 'Ada',
        'proposto da (cognome)': 'Fittizia',
        'proposto da (mail)': 'ada.fittizia@example.org',
        'proposto il': daysAgo(6),
        'come si lascia': 'Con due settimane di preavviso.',
        'come si revoca': 'Il Direttivo, con una delibera.',
        stato: 'proposto',
      }),
      commitment({
        id: 'IMP-0004',
        titolo: 'Corso di potatura',
        'cosa si fa': 'Organizzare due giornate di potatura negli orti dei soci.',
        'cantiere o GdL': 'Formazione',
        giornate: 4,
        'fino a quando': daysAgo(-90),
        tipo: 'a progetto',
        consegne: 'Le due giornate, con il foglio delle presenze.',
        'chi verifica (numero socio)': 12,
        retribuzione: 'rimborso spese',
        'proposto da (numero socio)': 34,
        'proposto il': daysAgo(20),
        'delibera del Coordinamento il': daysAgo(5),
        'come si lascia': 'Con un mese di preavviso.',
        'come si revoca': 'Il Direttivo, sentito il Coordinamento.',
        stato: 'proposto',
      }),
      commitment({
        id: 'IMP-0005',
        titolo: 'Stand alla fiera regionale',
        'cantiere o GdL': 'Comunicazione',
        'proposto il': daysAgo(25),
        stato: 'respinto',
        'motivo del respingimento': 'Il Coordinamento preferisce aspettare il bando di primavera.',
      }),
      commitment({
        id: 'IMP-0006',
        titolo: 'Mappa dei semenzai',
        'cantiere o GdL': 'GDL-orti',
        giornate: 5,
        'fino a quando': daysAgo(-60),
        tipo: 'a progetto',
        retribuzione: 'volontario',
        'ratifica del Direttivo il': daysAgo(30),
        stato: 'aperto',
      }),
      commitment({
        id: 'IMP-0007',
        titolo: 'Banco dei semi agli scambi',
        'cantiere o GdL': 'Semi e Biodiversità',
        giornate: 6,
        'fino a quando': daysAgo(-150),
        tipo: 'continuativo',
        retribuzione: 'rimborso spese',
        'ratifica del Direttivo il': daysAgo(60),
        stato: 'preso',
        'incaricato (numero socio)': 34,
        'ruolo di chi lo prende': 'una persona di Semi e Biodiversità',
      }),
      commitment({
        id: 'IMP-0008',
        titolo: 'Verbali del Coordinamento',
        'cantiere o GdL': 'Coordinamento',
        giornate: 10,
        'fino a quando': daysAgo(-200),
        tipo: 'continuativo',
        retribuzione: 'compenso',
        compenso: 600,
        'compenso visibile ai soci': 'no',
        'ratifica del Direttivo il': daysAgo(90),
        stato: 'in corso',
        'incaricato (numero socio)': 56,
        'ruolo di chi lo prende': 'una persona della segreteria',
        note: 'Ugo Fittizio ha dato la disponibilità',
      }),
      commitment({
        id: 'IMP-0009',
        titolo: 'Logistica del Raduno',
        'cantiere o GdL': 'Coordinamento',
        retribuzione: 'rimborso spese',
        'ratifica del Direttivo il': daysAgo(150),
        stato: 'chiuso',
        esito: 'completato',
        'incaricato (numero socio)': 34,
      }),
      commitment({
        id: 'IMP-0010',
        titolo: 'Video dei webinar',
        'cantiere o GdL': 'Formazione',
        retribuzione: 'volontario',
        'ratifica del Direttivo il': daysAgo(120),
        stato: 'chiuso',
        esito: 'ritirato',
      }),
    ],
    [SHEETS.commitmentResponses.name]: [[...SHEETS.commitmentResponses.columns]],
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
    [SHEETS.referents.name]: [
      [...referents],
      row(referents, {
        GdL: 'GDL-orti',
        'numero socio': 34,
        'nome da mostrare': 'Lia Prova',
        ruolo: 'referente',
        'consenso dal': daysAgo(30),
        'mail per la Riservata': 'lia.prova@example.org',
      }),
      row(referents, {
        GdL: 'GDL-orti',
        'nome da mostrare': 'Bruno Esempio',
        ruolo: 'co-referente',
        'mail per la Riservata': 'bruno.esempio@example.org',
      }),
      row(referents, {
        GdL: 'Semi e Biodiversità',
        'nome da mostrare': 'Teo Finto',
        ruolo: 'referente',
        'consenso dal': daysAgo(5),
        'mail per la Riservata': 'teo.finto@example.org',
      }),
      row(referents, {
        GdL: 'GDL-formazione',
        'nome da mostrare': 'Nina Demo',
        ruolo: 'referente',
        'mail per la Riservata': 'nina.demo@example.org',
      }),
    ],
    // Del gruppo Orti uno solo per il gruppo e uno aperto ai soci; uno del Coordinamento; uno fra 70 giorni, fuori.
    [SHEETS.meetings.name]: [
      [...meetings],
      row(meetings, {
        GdL: 'GDL-orti',
        'data e ora': at(3, '18:30'),
        'link Meet': DEMO_MEET.ortiInternal,
        'visibile ai soci': 'no',
      }),
      row(meetings, {
        GdL: 'GDL-orti',
        'data e ora': at(7, '18:30'),
        'link Meet': DEMO_MEET.orti,
        'visibile ai soci': 'sì',
      }),
      row(meetings, {
        GdL: 'Coordinamento',
        'data e ora': at(2, '21:00'),
        'link Meet': DEMO_MEET.coordination,
        'visibile ai soci': 'no',
      }),
      row(meetings, {
        GdL: 'GDL-semi',
        'data e ora': at(10, '18:00'),
        'link Meet': DEMO_MEET.semi,
        'visibile ai soci': 'sì',
      }),
      row(meetings, {
        GdL: 'GDL-formazione',
        'data e ora': at(70, '18:00'),
        'link Meet': DEMO_MEET.later,
        'visibile ai soci': 'sì',
      }),
    ],
    [SHEETS.links.name]: [
      [...links],
      row(links, {
        titolo: 'Calendario degli incontri',
        link: 'https://calendar.example.org/rami',
        'chi lo può aprire': 'tutti',
      }),
      row(links, {
        titolo: 'Modulo per proporre un evento',
        link: 'https://docs.google.com/forms/d/e/demo-evento/viewform',
        'chi lo può aprire': 'soci',
      }),
      row(links, {
        titolo: 'Cartella dei semenzai',
        link: 'https://drive.google.com/drive/folders/demo-orti',
        'chi lo può aprire': 'partecipanti del GdL',
        GdL: 'GDL-orti',
      }),
      row(links, {
        titolo: 'Verbali del Coordinamento',
        link: 'https://drive.google.com/drive/folders/demo-coordinamento',
        'chi lo può aprire': 'Coordinamento',
      }),
    ],
    [SHEETS.firstDay.name]: [
      [...firstDay],
      row(firstDay, {
        titolo: 'Scegli un gruppo',
        testo: 'Guarda i Gruppi: ognuno dice cosa fa, come si partecipa e quando si incontra.',
      }),
      row(firstDay, {
        titolo: 'Vieni a un incontro',
        testo:
          'Il prossimo incontro di ogni gruppo è sulla sua pagina, col link di Meet. Puoi venire anche solo ad ascoltare.',
      }),
      row(firstDay, {
        titolo: 'Entra nella chat',
        testo:
          'Se la chat del gruppo è aperta ai soci, il link è sulla pagina del gruppo; se no, scrivi alla segreteria.',
      }),
      row(firstDay, {
        titolo: 'Scegli un cantiere',
        testo: 'Guarda cosa sta facendo il gruppo, e chiedi dove serve una mano.',
        link: 'https://calendar.example.org/rami',
      }),
    ],
    [SHEETS.usage.name]: [[...SHEETS.usage.columns]],
    [SHEETS.settings.name]: [
      [...SHEETS.settings.columns],
      ['giorni per fermo', 30],
      ['link della segreteria', DEMO_OFFICE_URL],
      ['compenso visibile ai soci', 'no'],
    ],
    [SHEETS.health.name]: [[...SHEETS.health.columns]],
  }
}
