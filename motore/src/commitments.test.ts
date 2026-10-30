import { commitmentCoverage, coverageLabel, romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import {
  applyCommitmentResponses,
  commitmentBudget,
  readCommitments,
  rowsToWrite,
  type CommitmentRow,
} from './commitments.ts'
import { readTable, SHEETS } from './content.ts'
import { DEMO_COMMITMENT_ANSWER } from './demo.ts'
import type { CommitmentAnswer, FormResponse } from './form.ts'
import { memoryWorkbook } from './memory.ts'

const columns = SHEETS.commitments.columns
const row = (values: Record<string, unknown>) => columns.map((name) => values[name] ?? '')
const GROUPS = [
  { id: 'GDL-comunicazione', name: 'Comunicazione' },
  { id: 'GDL-semi', name: 'Semi e Biodiversità' },
]
const PROJECTS = [{ id: 'CAN-0004', groupId: 'GDL-comunicazione', title: 'Sito dei prodotti locali' }]
const TODAY = '2026-10-31'

function read(rows: Record<string, unknown>[], feeVisibleDefault = false, people = ['12', '34'], today = TODAY) {
  const workbook = memoryWorkbook({ [SHEETS.commitments.name]: [[...columns], ...rows.map(row)] })
  const warnings: string[] = []
  const commitments = readCommitments(readTable(workbook, SHEETS.commitments), {
    toCalendarDate: romeDate,
    warnings,
    groups: GROUPS,
    projects: PROJECTS,
    memberNumbers: people,
    feeVisibleDefault,
    today,
  })
  return { commitments, warnings }
}

const one = (values: Record<string, unknown>, feeVisibleDefault = false) => {
  const { commitments, warnings } = read(
    [{ id: 'IMP-0001', anno: 2026, titolo: 'Prova', ...values }],
    feeVisibleDefault,
  )
  return { commitment: commitments[0], warnings }
}

describe('la scheda «Impegni»', () => {
  it('«da scrivere» è il primo stato: una riga con solo id e titolo lo è', () => {
    const { commitment, warnings } = one({})
    expect(commitment).toMatchObject({ id: 'IMP-0001', title: 'Prova', status: 'toWrite', year: 2026 })
    expect(warnings).toEqual([])
  })

  it('legge gli stati con le loro parole, e «ratificato» vale «aperto»', () => {
    const words = {
      'da scrivere': 'toWrite',
      proposto: 'proposed',
      'approvato dal Coordinamento': 'approved',
      ratificato: 'open',
      aperto: 'open',
      preso: 'taken',
      'in corso': 'ongoing',
      consegnato: 'delivered',
    } as const
    for (const [word, status] of Object.entries(words)) {
      const dates = ['proposed', 'toWrite', 'approved'].includes(status)
        ? {}
        : { 'ratifica del Direttivo il': '2026-09-01' }
      expect(one({ stato: word, ...dates }).commitment?.status, word).toBe(status)
    }
  })

  it('le date della segreteria spostano lo stato: la delibera dopo «proposto», la ratifica dopo l’approvazione', () => {
    expect(one({ stato: 'proposto', 'delibera del Coordinamento il': '2026-10-10' }).commitment?.status).toBe(
      'approved',
    )
    const ratified = one({
      stato: 'approvato dal Coordinamento',
      'delibera del Coordinamento il': '2026-10-10',
      'ratifica del Direttivo il': '15/10/2026',
    }).commitment
    expect(ratified).toMatchObject({ status: 'open', coordinationOn: '2026-10-10', ratifiedOn: '2026-10-15' })
  })

  it('un impegno proposto, quando viene respinto, è «respinto», con il motivo', () => {
    const { commitment, warnings } = one({
      stato: 'respinto',
      'proposto il': '2026-10-01',
      'motivo del respingimento': 'Si aspetta il bando di primavera.',
    })
    expect(commitment).toMatchObject({ status: 'rejected', rejectionReason: 'Si aspetta il bando di primavera.' })
    expect(warnings).toEqual([])
  })

  it('un respinto senza motivo lo dice in «Salute»', () => {
    const { commitment, warnings } = one({ stato: 'respinto' })
    expect(commitment?.status).toBe('rejected')
    expect(warnings).toEqual(['«Impegni», riga 2: l’impegno è respinto, ma manca il «motivo del respingimento».'])
  })

  it('preso senza ratifica: resta preso nella Riservata, e l’avviso dice che non esce sul sito', () => {
    const { commitment, warnings } = one({
      stato: 'preso',
      'incaricato (numero socio)': 34,
      'cantiere o GdL': 'Comunicazione',
    })
    expect(commitment).toMatchObject({ status: 'taken', ratifiedOn: null, assigneeNumber: '34' })
    expect(warnings).toEqual([
      '«Impegni», riga 2: lo stato è «preso», ma manca «ratifica del Direttivo il»: l’impegno non esce sul sito.',
    ])
  })

  it('ogni chiusura ha il suo esito; senza, l’avviso', () => {
    expect(
      one({ stato: 'chiuso', esito: 'ritirato', 'ratifica del Direttivo il': '2026-03-01' }).commitment?.outcome,
    ).toBe('withdrawn')
    const { commitment, warnings } = one({ stato: 'chiuso', 'ratifica del Direttivo il': '2026-03-01' })
    expect(commitment?.outcome).toBeNull()
    expect(warnings).toEqual([
      '«Impegni», riga 2: l’impegno è chiuso, ma manca l’esito: completato, revocato o ritirato.',
    ])
  })

  it('uno stato che non conosco: la riga non si pubblica', () => {
    const { commitments, warnings } = read([{ id: 'IMP-0001', titolo: 'Prova', stato: 'sospeso' }])
    expect(commitments).toEqual([])
    expect(warnings).toEqual(['«Impegni», riga 2: lo stato «sospeso» non lo conosco, l’impegno non si pubblica.'])
  })

  it('un nome al posto del numero socio non esce: vale vuoto, con l’avviso', () => {
    const { commitment, warnings } = one({ stato: 'preso', 'incaricato (numero socio)': 'Ugo Fittizio' })
    expect(commitment?.assigneeNumber).toBeNull()
    expect(warnings).toContain(
      '«Impegni», riga 2: in «incaricato (numero socio)» va il numero socio, mai il nome: non esce.',
    )
  })

  it('chi verifica deve essere fra le Persone della Riservata', () => {
    const { warnings } = one({ 'chi verifica (numero socio)': 99 })
    expect(warnings).toEqual(['«Impegni», riga 2: chi verifica (99) non è fra le Persone della Riservata.'])
  })

  it('il ruolo di chi lo prende è un ruolo, mai un nome', () => {
    const { commitment, warnings } = one({ 'ruolo di chi lo prende': 'una persona di Semi e Biodiversità' })
    expect(commitment?.assigneeRole).toBe('una persona di Semi e Biodiversità')
    expect(warnings).toEqual([])
    const named = one({ 'ruolo di chi lo prende': 'il socio Ugo Fittizio' })
    expect(named.commitment?.assigneeRole).toBe('')
    expect(named.warnings[0]).toContain('«Ugo» sembra un nome')
  })

  it('il cantiere o GdL: un GdL per nome o per id, un cantiere dal codice, che porta il suo GdL', () => {
    expect(one({ 'cantiere o GdL': 'comunicazione' }).commitment).toMatchObject({
      forLabel: 'Comunicazione',
      groupId: 'GDL-comunicazione',
    })
    expect(one({ 'cantiere o GdL': 'Il sito, CAN-0004' }).commitment).toMatchObject({
      forLabel: 'Sito dei prodotti locali',
      groupId: 'GDL-comunicazione',
    })
    expect(one({ 'cantiere o GdL': 'Coordinamento' }).commitment).toMatchObject({
      forLabel: 'Coordinamento',
      groupId: null,
    })
  })

  it('«compenso visibile ai soci» vuoto vale ciò che dice «Impostazioni», di partenza no', () => {
    expect(one({ retribuzione: 'compenso', compenso: '1.200' }).commitment).toMatchObject({
      pay: 'paid',
      fee: 1200,
      feeVisible: false,
    })
    expect(one({ retribuzione: 'compenso', compenso: 1200 }, true).commitment?.feeVisible).toBe(true)
    expect(
      one({ retribuzione: 'compenso', compenso: 1200, 'compenso visibile ai soci': 'no' }, true).commitment?.feeVisible,
    ).toBe(false)
  })

  it('l’anno: quello scritto; se no, un impegno vivo è dell’anno di oggi, un chiuso dell’anno della ratifica', () => {
    const { commitments, warnings } = read([
      { id: 'IMP-0001', titolo: 'A', anno: 2025 },
      { id: 'IMP-0002', titolo: 'B', stato: 'proposto', 'proposto il': '2025-12-20' },
      { id: 'IMP-0003', titolo: 'C' },
      {
        id: 'IMP-0004',
        titolo: 'D',
        stato: 'chiuso',
        esito: 'completato',
        'proposto il': '2024-11-02',
        'ratifica del Direttivo il': '2025-03-01',
      },
      {
        id: 'IMP-0005',
        titolo: 'E',
        stato: 'respinto',
        'motivo del respingimento': 'Non serve',
        'proposto il': '2025-11-02',
      },
    ])
    expect(commitments.map((commitment) => commitment.year)).toEqual([2025, 2026, 2026, 2025, 2025])
    // Il modello non ha la data di chiusura: per un chiuso senza «anno» vale la ratifica, e la segreteria lo sa.
    expect(warnings).toEqual([
      '«Impegni», riga 5: l’impegno è chiuso e manca «anno»: lo conto nel 2025, l’anno della ratifica. Scrivi ' +
        'l’anno in cui si è chiuso.',
    ])
  })

  it('a capodanno un impegno preso a dicembre resta fra i coperti, e le righe senza anno passano all’anno nuovo', () => {
    const rows = [
      {
        id: 'IMP-0001',
        titolo: 'Preso a dicembre',
        stato: 'preso',
        'cantiere o GdL': 'Comunicazione',
        'proposto il': '2026-12-10',
        'ratifica del Direttivo il': '2026-12-12',
      },
      {
        id: 'IMP-0002',
        titolo: 'In corso da dicembre',
        stato: 'in corso',
        'cantiere o GdL': 'Comunicazione',
        'proposto il': '2026-12-11',
        'ratifica del Direttivo il': '2026-12-14',
      },
      { id: 'IMP-0003', titolo: 'Da scrivere' },
      {
        id: 'IMP-0004',
        titolo: 'Chiuso a giugno',
        anno: 2026,
        stato: 'chiuso',
        esito: 'completato',
        'ratifica del Direttivo il': '2026-03-01',
      },
      // Scritto per il 2026 e ancora preso: vive anche nel 2027.
      {
        id: 'IMP-0005',
        titolo: 'Preso nel 2026',
        anno: 2026,
        stato: 'preso',
        'cantiere o GdL': 'Comunicazione',
        'ratifica del Direttivo il': '2026-05-01',
      },
    ]
    const lastDay = read(rows, false, ['12', '34'], '2026-12-31')
    expect(lastDay.warnings).toEqual([])
    expect(coverageLabel(commitmentCoverage(lastDay.commitments, 2026))).toBe('Impegni coperti: 4 su 5 (80%)')
    const newYear = read(rows, false, ['12', '34'], '2027-01-01')
    expect(newYear.commitments.map((commitment) => commitment.year)).toEqual([2027, 2027, 2027, 2026, 2026])
    expect(coverageLabel(commitmentCoverage(newYear.commitments, 2027))).toBe('Impegni coperti: 3 su 4 (75%)')
  })

  it('un «cantiere o GdL» che non è un GdL, un cantiere o un organo di RAMI va in «Da controllare» e non esce', () => {
    const typo = one({ 'cantiere o GdL': 'Comunicaz' })
    expect(typo.commitment).toMatchObject({ forLabel: '', groupId: null })
    expect(typo.warnings).toEqual([
      '«Impegni», riga 2: «cantiere o GdL» vale «Comunicaz»: non è un GdL, un cantiere o un organo di RAMI che ' +
        'conosco, e non esce.',
    ])
    // Il testo libero del Modulo può portare un nome: esce solo il nome riconosciuto (M7).
    const named = one({ 'cantiere o GdL': 'Mario Rossi', stato: 'preso', 'ratifica del Direttivo il': '2026-10-01' })
    expect(named.commitment?.forLabel).toBe('')
    expect(JSON.stringify(named.commitment)).not.toContain('Mario Rossi')
    expect(named.warnings).toHaveLength(2)
    expect(named.warnings[1]).toContain('si mostra solo «Preso»')
    expect(one({ 'cantiere o GdL': 'il direttivo' }).commitment?.forLabel).toBe('il direttivo')
    expect(one({ 'cantiere o GdL': 'Il sito, CAN-0099' }).warnings).toHaveLength(1)
    for (const known of ['Comunicazione', 'GDL-semi', 'Il sito, CAN-0004', 'Coordinamento', 'il direttivo', ''])
      expect(one({ 'cantiere o GdL': known }).warnings, known).toEqual([])
  })

  it('un impegno preso senza il ruolo né il cantiere o GdL: l’avviso, perché si mostrerebbe solo «Preso»', () => {
    const taken = { stato: 'preso', 'ratifica del Direttivo il': '2026-10-01' }
    expect(one(taken).warnings).toEqual([
      '«Impegni», riga 2: l’impegno è «preso», ma mancano il «ruolo di chi lo prende» e il «cantiere o GdL»: si ' +
        'mostra solo «Preso».',
    ])
    expect(one({ ...taken, 'ruolo di chi lo prende': 'una persona della segreteria' }).warnings).toEqual([])
    expect(one({ ...taken, 'cantiere o GdL': 'Coordinamento' }).warnings).toEqual([])
  })

  it('un id che non è nella forma IMP-0001 non si sceglierebbe dal Modulo: l’impegno non si pubblica', () => {
    const { commitments, warnings } = read([
      { id: 'imp-0004', titolo: 'A' },
      { id: 'IMP-6 bis', titolo: 'B' },
      { id: 'IMP-0007', titolo: 'C' },
    ])
    expect(commitments.map((commitment) => commitment.id)).toEqual(['IMP-0007'])
    expect(rowsToWrite(commitments)).toEqual(['C (IMP-0007)'])
    expect(warnings).toEqual([
      '«Impegni», riga 2: l’id «imp-0004» non è nella forma IMP-0001, e dal Modulo non si sceglierebbe: l’impegno ' +
        'non si pubblica.',
      '«Impegni», riga 3: l’id «IMP-6 bis» non è nella forma IMP-0001, e dal Modulo non si sceglierebbe: l’impegno ' +
        'non si pubblica.',
    ])
  })

  it('le note della segreteria restano nel Foglio', () => {
    const { commitment } = one({ note: 'Sentire Ugo Fittizio per i tempi' })
    expect(JSON.stringify(commitment)).not.toContain('Fittizio')
  })

  it('nome, cognome e mail di chi propone restano nel Foglio: esce solo il numero socio', () => {
    const { commitment } = one({
      'proposto da (numero socio)': '34',
      'proposto da (nome)': 'Zelinda',
      'proposto da (cognome)': 'Provalunga',
      'proposto da (mail)': 'zelinda.provalunga@example.org',
    })
    expect(commitment?.proposedBy).toBe('34')
    const read = JSON.stringify(commitment)
    for (const value of ['Zelinda', 'Provalunga', 'zelinda.provalunga@example.org']) expect(read).not.toContain(value)
  })

  it('l’elenco del Modulo: le righe «da scrivere», col titolo e l’id', () => {
    const { commitments } = read([
      { id: 'IMP-0001', titolo: 'La cura della Bussola' },
      { id: 'IMP-0002', titolo: 'Newsletter', stato: 'proposto' },
      { id: 'IMP-0003', titolo: 'Banco dei semi' },
    ])
    expect(rowsToWrite(commitments)).toEqual(['La cura della Bussola (IMP-0001)', 'Banco dei semi (IMP-0003)'])
  })
})

describe('budget e speso per impegno, come per i cantieri', () => {
  const lines = [
    { label: 'Ciclo webinar e corsi', planned: 5000, spent: 1200 },
    { label: 'Tesseramento online (IMP-0003)', planned: 800, spent: 200 },
    { label: 'verbali del coordinamento', planned: 600, spent: null },
  ]
  it('la voce col codice dell’impegno, o col suo titolo', () => {
    expect(commitmentBudget({ id: 'IMP-0003', title: 'Tesseramento online' }, lines)).toEqual({
      planned: 800,
      spent: 200,
    })
    expect(commitmentBudget({ id: 'IMP-0008', title: 'Verbali del Coordinamento' }, lines)).toEqual({
      planned: 600,
      spent: null,
    })
    expect(commitmentBudget({ id: 'IMP-0009', title: 'Altro' }, lines)).toEqual({ planned: null, spent: null })
  })
})

const response = (fields: Partial<CommitmentAnswer> = {}, id = 'p1', at = '2026-10-31T17:42:00Z') =>
  ({
    id,
    submittedAt: new Date(at),
    answer: { ...DEMO_COMMITMENT_ANSWER, ...fields },
  }) satisfies FormResponse<CommitmentAnswer>

const rows = (): CommitmentRow[] =>
  read([
    { id: 'IMP-0001', titolo: 'La cura della Bussola' },
    { id: 'IMP-0002', titolo: 'Newsletter', stato: 'approvato dal Coordinamento' },
  ]).commitments

describe('le risposte del Modulo «Proponi un impegno»', () => {
  const apply = (responses: FormResponse<CommitmentAnswer>[], feeVisibleDefault = false) =>
    applyCommitmentResponses(responses, rows(), { memberNumbers: ['12', '34'], feeVisibleDefault })

  it('scelta la riga «da scrivere», la completa: stato proposto, «proposto il» dall’ora della risposta', () => {
    const { outcomes, changes } = apply([response()])
    expect(outcomes.map((item) => item.outcome)).toEqual(['applicata a IMP-0001'])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ id: 'IMP-0001', index: 1 })
    expect(changes[0]?.cells).toMatchObject({
      stato: 'proposto',
      'cosa si fa': DEMO_COMMITMENT_ANSWER.what,
      'cantiere o GdL': 'Comunicazione',
      giornate: 12,
      'fino a quando': '2027-06-30',
      tipo: 'continuativo',
      'chi verifica (numero socio)': '12',
      retribuzione: 'compenso',
      compenso: 1200,
      'compenso visibile ai soci': 'no',
      'proposto da (numero socio)': '34',
      'proposto da (nome)': DEMO_COMMITMENT_ANSWER.proposerFirstName,
      'proposto da (cognome)': DEMO_COMMITMENT_ANSWER.proposerLastName,
      'proposto da (mail)': DEMO_COMMITMENT_ANSWER.proposerEmail,
      'proposto il': new Date('2026-10-31T17:42:00Z'),
    })
  })

  it('due risposte per la stessa riga: la prima la completa, la seconda va in «Da controllare»', () => {
    const { changes, outcomes } = apply([response(), response({ days: '15' }, 'p2', '2026-10-31T17:45:00Z')])
    expect(changes).toHaveLength(1)
    expect(changes[0]?.cells.giornate).toBe(12)
    expect(outcomes.map((item) => item.outcome)).toEqual([
      'applicata a IMP-0001',
      'da controllare: l’impegno IMP-0001 è già stato proposto da un’altra risposta',
    ])
  })

  it('una riga già proposta da un’altra risposta non si riscrive; la stessa risposta, ripetuta, sì', () => {
    const at = '2026-10-31T17:42:00Z'
    const proposed = read([
      { id: 'IMP-0003', titolo: 'Banco', stato: 'proposto', 'proposto il': new Date(at) },
      { id: 'IMP-0004', titolo: 'Fiera', stato: 'proposto', 'proposto il': '2026-10-31' },
    ]).commitments
    const settings = { memberNumbers: ['12', '34'], feeVisibleDefault: false }
    const outcome = (row: string, when: string) =>
      applyCommitmentResponses([response({ row }, 'p9', when)], proposed, settings).outcomes[0]?.outcome
    // Il giro si era fermato dopo la riga: la risposta torna, con lo stesso momento d'invio.
    expect(outcome('Banco (IMP-0003)', at)).toBe('applicata a IMP-0003')
    // Un'altra risposta, da una scheda rimasta aperta, o una riga scritta a mano.
    expect(outcome('Banco (IMP-0003)', '2026-11-02T09:00:00Z')).toBe(
      'da controllare: l’impegno IMP-0003 è già stato proposto da un’altra risposta',
    )
    expect(outcome('Fiera (IMP-0004)', at)).toBe(
      'da controllare: l’impegno IMP-0004 è già stato proposto da un’altra risposta',
    )
  })

  it('una riga già approvata non si cambia dal Modulo', () => {
    const { changes, outcomes } = apply([response({ row: 'Newsletter (IMP-0002)' })])
    expect(changes).toEqual([])
    expect(outcomes[0]?.outcome).toBe(
      'da controllare: l’impegno IMP-0002 è «Approvato dal Coordinamento»: la scheda non si cambia dal Modulo',
    )
  })

  it('una riga che non c’è, o nessuna riga, va in «Da controllare»', () => {
    expect(apply([response({ row: 'Altro (IMP-0099)' })]).outcomes[0]?.outcome).toBe(
      'da controllare: l’impegno IMP-0099 non c’è nella scheda «Impegni»',
    )
    expect(apply([response({ row: 'Nessun impegno da scrivere: chiedi alla segreteria' })]).outcomes[0]?.outcome).toBe(
      'da controllare: non è scelto nessun impegno da scrivere',
    )
  })

  it('chi verifica e chi propone devono essere fra le Persone della Riservata', () => {
    expect(apply([response({ verifier: '99' })]).outcomes[0]?.outcome).toBe(
      'da controllare: chi verifica (99) non è fra le Persone della Riservata',
    )
    expect(apply([response({ proposer: '77' })]).outcomes[0]?.outcome).toBe(
      'da controllare: chi propone (77) non è fra le Persone della Riservata',
    )
  })

  it('chi propone scrive nome, cognome, numero socio e mail: se ne manca uno, la risposta va in «Da controllare»', () => {
    const outcome = (fields: Partial<CommitmentAnswer>) => apply([response(fields)]).outcomes[0]?.outcome
    expect(outcome({ proposerFirstName: ' ' })).toBe('da controllare: mancano il nome o il cognome di chi propone')
    expect(outcome({ proposerLastName: '' })).toBe('da controllare: mancano il nome o il cognome di chi propone')
    expect(outcome({ proposer: '' })).toBe('da controllare: manca il numero socio di chi propone')
    for (const proposerEmail of ['', 'ada.fittizia', 'ada fittizia@example.org'])
      expect(outcome({ proposerEmail }), proposerEmail).toBe('da controllare: la mail di chi propone non è una mail')
  })

  it('le giornate, la data, il tipo e la retribuzione si devono leggere; il compenso vuole la cifra', () => {
    const outcome = (fields: Partial<CommitmentAnswer>) => apply([response(fields)]).outcomes[0]?.outcome
    expect(outcome({ days: 'tante' })).toBe('da controllare: le giornate «tante» non le leggo')
    expect(outcome({ until: '30 giugno' })).toBe('da controllare: la data «30 giugno» non la leggo')
    expect(outcome({ fee: '' })).toBe('da controllare: per un compenso serve la cifra')
    const volunteer = apply([response({ pay: 'Volontario', fee: '500' })]).changes[0]?.cells
    expect(volunteer).toMatchObject({ retribuzione: 'volontario', compenso: '' })
  })

  it('«il compenso si vede ai soci» senza risposta prende il valore di «Impostazioni»', () => {
    expect(apply([response({ feeVisible: '' })]).changes[0]?.cells['compenso visibile ai soci']).toBe('no')
    expect(apply([response({ feeVisible: '' })], true).changes[0]?.cells['compenso visibile ai soci']).toBe('sì')
    expect(apply([response({ feeVisible: 'Sì' })]).changes[0]?.cells['compenso visibile ai soci']).toBe('sì')
  })
})
