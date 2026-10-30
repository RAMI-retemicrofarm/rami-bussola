import { romeDate, romeDateTime } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import {
  ContentError,
  readAmount,
  readBudget,
  readDeadlines,
  readFirstDay,
  readGroups,
  readIssues,
  readLinks,
  readLocalDateTime,
  readMeetings,
  readOptionalTable,
  readPeople,
  readProjects,
  readReferents,
  readResolutions,
  readRole,
  readSettings,
  readTable,
  readYesNo,
  SHEETS,
  text,
  type SheetSpec,
} from './content.ts'
import { demoSheets } from './demo.ts'
import { memoryWorkbook } from './memory.ts'

const now = new Date('2026-10-31T10:00:00Z')

describe('readTable', () => {
  it('trova le colonne per nome, in qualunque ordine e con maiuscole e spazi diversi', () => {
    const workbook = memoryWorkbook({
      GdL: [
        [' Codice del gruppo', 'NOME ', 'id'],
        ['k1', 'Orti', 'GDL-orti'],
      ],
    })
    const table = readTable(workbook, SHEETS.groups)
    expect(table.rows[0]?.get('id')).toBe('GDL-orti')
    expect(table.rows[0]?.get('codice del gruppo')).toBe('k1')
  })

  it('salta le righe vuote', () => {
    const workbook = memoryWorkbook({
      GdL: [
        ['id', 'nome', 'codice del gruppo'],
        ['', '', ''],
        ['GDL-a', 'A', 'k'],
      ],
    })
    const table = readTable(workbook, SHEETS.groups)
    expect(table.rows.map((row) => row.index)).toEqual([2])
  })

  it('se manca una colonna che serve si ferma, e dice quale e in che scheda', () => {
    const workbook = memoryWorkbook({ GdL: [['id', 'nome']] })
    expect(() => readTable(workbook, SHEETS.groups)).toThrow(ContentError)
    expect(() => readTable(workbook, SHEETS.groups)).toThrow('«GdL»: manca la colonna «codice del gruppo»')
  })

  it('se manca la scheda si ferma, e dice quale', () => {
    expect(() => readTable(memoryWorkbook({}), SHEETS.health)).toThrow('Manca la scheda «Salute»')
  })
})

describe('text', () => {
  it('una data in una colonna di testo si legge come la scrive una persona', () => {
    expect(text(new Date(2026, 10, 15))).toBe('15/11/2026')
    expect(text(new Date(2026, 10, 15, 18, 30))).toBe('15/11/2026 18:30')
  })

  it('il resto è il testo della cella, senza spazi ai lati', () => {
    expect(text('  Orti  ')).toBe('Orti')
    expect(text(34)).toBe('34')
    expect(text(null)).toBe('')
  })
})

describe('readProjects', () => {
  const projects = (rows: Record<string, unknown>[]) => {
    const columns = SHEETS.projects.columns
    const workbook = memoryWorkbook({
      Cantieri: [[...columns], ...rows.map((values) => columns.map((name) => values[name] ?? ''))],
    })
    const warnings: string[] = []
    return { list: readProjects(readTable(workbook, SHEETS.projects), romeDate, warnings), warnings }
  }
  const base = { id: 'CAN-0001', GdL: 'GDL-orti', titolo: 'Mercati', stato: 'in corso' }

  it('legge lo stato scritto a parole, con le maiuscole o senza', () => {
    expect(projects([{ ...base, stato: 'In revisione' }]).list[0]?.stage).toBe('review')
  })

  it('legge le date come le dà Google, come testo AAAA-MM-GG e come GG/MM/AAAA', () => {
    const { list } = projects([
      { ...base, 'aggiornato il': new Date('2026-10-17T22:30:00Z'), scadenza: '2026-11-20' },
      { ...base, id: 'CAN-0002', scadenza: '5/12/2026' },
    ])
    expect(list[0]?.updatedOn).toBe('2026-10-18')
    expect(list[0]?.dueOn).toBe('2026-11-20')
    expect(list[1]?.dueOn).toBe('2026-12-05')
    expect(list[1]?.updatedOn).toBeNull()
  })

  it('un cantiere con uno stato che non conosce non si pubblica, e lo dice', () => {
    const { list, warnings } = projects([{ ...base, stato: 'sospeso' }])
    expect(list).toEqual([])
    expect(warnings).toEqual(['«Cantieri», riga 2: lo stato «sospeso» non lo conosco, il cantiere non si pubblica.'])
  })

  it('una data che non si legge diventa vuota, e lo dice', () => {
    const { list, warnings } = projects([{ ...base, scadenza: 'dopo Natale' }])
    expect(list[0]?.dueOn).toBeNull()
    expect(warnings).toEqual(['«Cantieri», riga 2: la data «dopo Natale» in «scadenza» non la leggo.'])
  })

  it('un cantiere senza id non si pubblica, e lo dice', () => {
    const { list, warnings } = projects([{ ...base, id: '' }])
    expect(list).toEqual([])
    expect(warnings).toEqual(['«Cantieri», riga 2: manca l’id, il cantiere non si pubblica.'])
  })

  it('un id che c’è già vale per la prima riga; la seconda non si pubblica, e lo dice', () => {
    const { list, warnings } = projects([base, { ...base, titolo: 'Copia' }])
    expect(list.map((project) => project.title)).toEqual(['Mercati'])
    expect(warnings).toEqual(['«Cantieri», riga 3: l’id CAN-0001 c’è già alla riga 2, il cantiere non si pubblica.'])
  })
})

describe('readPeople', () => {
  const read = (sheets = demoSheets(now)) => {
    const warnings: string[] = []
    return { list: readPeople(readTable(memoryWorkbook(sheets), SHEETS.people), warnings), warnings }
  }

  it('legge uno o più ruoli, scritti a parole', () => {
    const sheets = demoSheets(now)
    sheets['Persone della Riservata']?.push(['PER-09', 'cura@example.org', 56, 'Direttivo, cura della Bussola', ''])
    expect(read(sheets).list.at(-1)?.roles).toEqual(['board', 'keeper'])
  })

  it('il numero socio diventa testo, e chi non è socio non ce l’ha', () => {
    const { list } = read()
    expect(list[0]?.memberNumber).toBe('12')
    expect(list.find((person) => person.roles.includes('office'))?.memberNumber).toBeNull()
  })

  it('il GdL vale solo per chi è rappresentante', () => {
    const sheets = demoSheets(now)
    sheets['Persone della Riservata']?.push(['PER-09', 'x@example.org', '', 'Direttivo', 'GDL-orti'])
    expect(read(sheets).list.at(-1)?.groupId).toBeNull()
    expect(read(sheets).list[1]?.groupId).toBe('GDL-orti')
  })

  it('un ruolo che non conosce si salta, e lo dice', () => {
    const sheets = demoSheets(now)
    sheets['Persone della Riservata']?.push(['PER-09', 'x@example.org', '', 'Direttivo, tesoreria', ''])
    const { list, warnings } = read(sheets)
    expect(list.at(-1)?.roles).toEqual(['board'])
    expect(warnings).toEqual(['«Persone della Riservata», riga 7: il ruolo «tesoreria» non lo conosco.'])
  })

  it('una persona senza mail non entra, e lo dice', () => {
    const sheets = demoSheets(now)
    sheets['Persone della Riservata']?.push(['PER-09', '', '', 'Direttivo', ''])
    const { list, warnings } = read(sheets)
    expect(list).toHaveLength(5)
    expect(warnings).toEqual(['«Persone della Riservata», riga 7: manca la mail.'])
  })
})

describe('readSettings', () => {
  it('legge i giorni per «fermo»', () => {
    const workbook = memoryWorkbook({
      Impostazioni: [
        ['voce', 'valore'],
        ['Giorni per fermo', 20],
      ],
    })
    expect(readSettings(readTable(workbook, SHEETS.settings), []).staleDays).toBe(20)
  })

  it('se la riga manca, sono 30', () => {
    const workbook = memoryWorkbook({ Impostazioni: [['voce', 'valore']] })
    expect(readSettings(readTable(workbook, SHEETS.settings), []).staleDays).toBe(30)
  })

  it('se il valore non è un numero di giorni, sono 30, e lo dice', () => {
    const warnings: string[] = []
    const workbook = memoryWorkbook({
      Impostazioni: [
        ['voce', 'valore'],
        ['giorni per fermo', 'trenta'],
      ],
    })
    expect(readSettings(readTable(workbook, SHEETS.settings), warnings).staleDays).toBe(30)
    expect(warnings).toEqual(['«Impostazioni»: «giorni per fermo» vale «trenta», uso 30.'])
  })
})

/** Una scheda con le colonne dello spec e le righe date per nome. */
function table(spec: SheetSpec, rows: Record<string, unknown>[]) {
  const workbook = memoryWorkbook({
    [spec.name]: [[...spec.columns], ...rows.map((values) => spec.columns.map((name) => values[name] ?? ''))],
  })
  return readTable(workbook, spec)
}

describe('SHEETS', () => {
  it('ha le schede nell’ordine in cui le crea la preparazione', () => {
    expect(Object.values(SHEETS).map((spec) => spec.name)).toEqual([
      'GdL',
      'Cantieri',
      'Aggiornamenti',
      'Scadenze',
      'Delibere',
      'Questioni',
      'Budget',
      'Persone della Riservata',
      'Misure',
      'Referenti',
      'Incontri',
      'Link',
      'Primo giorno',
      'Impegni',
      'Proposte di impegno',
      'Uso',
      'Impostazioni',
      'Salute',
    ])
  })
})

describe('readRole', () => {
  it('un ruolo comincia con un articolo o un determinante', () => {
    for (const role of [
      'il tesoriere',
      'una persona di Struttura',
      'Il Direttivo',
      'l’ufficio stampa',
      "un'esperta",
      'chi cura la Bussola',
    ])
      expect(readRole(role, 'chi segue (ruolo)'), role).toEqual({ role, warning: null })
  })

  it('vuoto vuol dire nessuno, senza avviso', () => {
    expect(readRole('', 'chi segue (ruolo)')).toEqual({ role: '', warning: null })
  })

  it('un nome non esce mai: avvisa e lo tratta come nessuno', () => {
    expect(readRole('Mario Rossi', 'chi segue (ruolo)')).toEqual({
      role: '',
      warning:
        '«chi segue (ruolo)» dice «Mario Rossi»: scrivi un ruolo, come «il tesoriere» o «una persona di Struttura», ' +
        'mai un nome. Intanto esce come «Nessuno la segue».',
    })
  })

  it('con la maiuscola passano gli organi, i gruppi della scheda «Gruppi» e il nome che segue «gruppo»', () => {
    for (const role of [
      'un membro del Direttivo',
      'i referenti dei GdL',
      'una persona di Formazione',
      'il referente di Orti e Suoli',
      'il gruppo Pubbliche Relazioni',
      'il GdL Raduno',
      'il referente Erasmus',
    ])
      expect(readRole(role, 'chi segue (ruolo)', ['Formazione', 'Orti e Suoli']), role).toEqual({
        role,
        warning: null,
      })
  })

  it('un nome dentro un ruolo non esce, anche se la cella comincia con un articolo', () => {
    for (const value of [
      'il tesoriere (Mario Rossi)',
      'il tesoriere, Mario Rossi',
      'chi cura: Anna Bianchi',
      'il tesoriere Mario Rossi',
      'la segreteria di Anna',
      'Il dott. Mario Rossi',
      'La Rosa',
      'Lo Presti',
      'Gli Esposito',
      "L'Abate",
      'una persona di Formazione',
    ])
      expect(readRole(value, 'chi segue (ruolo)').role, value).toBe('')
  })

  it('l’avviso dice quale parola sembra un nome, o quale segno non va', () => {
    expect(readRole('La Rosa', 'chi segue (ruolo)').warning).toBe(
      '«chi segue (ruolo)» dice «La Rosa»: «Rosa» sembra un nome. Con la maiuscola vanno solo gli organi di RAMI, ' +
        'come «il Direttivo», e i gruppi della scheda «Gruppi». Intanto esce come «Nessuno la segue».',
    )
    expect(readRole('il tesoriere (vice)', 'chi segue (ruolo)').warning).toBe(
      '«chi segue (ruolo)» dice «il tesoriere (vice)»: un ruolo si scrive senza parentesi, virgole, due punti o ' +
        'chiocciole, come «il tesoriere». Intanto esce come «Nessuno la segue».',
    )
  })
})

describe('readDeadlines', () => {
  const read = (rows: Record<string, unknown>[]) => {
    const warnings: string[] = []
    return { list: readDeadlines(table(SHEETS.deadlines, rows), romeDate, warnings), warnings }
  }
  const base = {
    id: 'SCA-0001',
    cosa: 'Rendiconto',
    tipo: 'adempimento',
    data: '2026-11-20',
    'chi segue (ruolo)': 'il tesoriere',
  }

  it('legge una scadenza coi campi della Riservata', () => {
    const { list, warnings } = read([{ ...base, 'fatta il': new Date('2026-11-18T23:30:00Z') }])
    expect(list).toEqual([
      {
        id: 'SCA-0001',
        what: 'Rendiconto',
        kind: 'duty',
        dueOn: '2026-11-20',
        ownerRole: 'il tesoriere',
        doneOn: '2026-11-19',
        membersCanSee: false,
      },
    ])
    expect(warnings).toEqual([])
  })

  it('legge il tipo a parole, con le maiuscole o senza', () => {
    const kinds = ['bando', 'Adempimento', 'fiscale', 'evento', 'Assemblea', 'MISURA']
    const { list } = read(kinds.map((tipo, i) => ({ ...base, id: `SCA-${i}`, tipo })))
    expect(list.map((deadline) => deadline.kind)).toEqual(['call', 'duty', 'tax', 'event', 'assembly', 'measure'])
  })

  it('senza tipo la tratta come adempimento, e lo dice', () => {
    const { list, warnings } = read([{ ...base, tipo: '' }])
    expect(list[0]?.kind).toBe('duty')
    expect(warnings).toEqual(['«Scadenze», riga 2: manca il tipo: la tratto come adempimento.'])
  })

  it('un tipo che non conosce non si pubblica, e lo dice', () => {
    const { list, warnings } = read([{ ...base, tipo: 'riunione' }])
    expect(list).toEqual([])
    expect(warnings).toEqual(['«Scadenze», riga 2: il tipo «riunione» non lo conosco, la scadenza non si pubblica.'])
  })

  it('senza id, o con un id che c’è già, non si pubblica, e lo dice', () => {
    const { list, warnings } = read([base, { ...base, id: '' }, { ...base, cosa: 'Copia' }])
    expect(list.map((deadline) => deadline.what)).toEqual(['Rendiconto'])
    expect(warnings).toEqual([
      '«Scadenze», riga 3: manca l’id, la scadenza non si pubblica.',
      '«Scadenze», riga 4: l’id SCA-0001 c’è già alla riga 2, la scadenza non si pubblica.',
    ])
  })

  it('senza data, o con una data che non legge, non si pubblica, e lo dice', () => {
    const { list, warnings } = read([
      { ...base, data: '' },
      { ...base, id: 'SCA-0002', data: 'a Natale' },
    ])
    expect(list).toEqual([])
    expect(warnings).toEqual([
      '«Scadenze», riga 2: manca la data, la scadenza non si pubblica.',
      '«Scadenze», riga 3: la data «a Natale» in «data» non la leggo, la scadenza non si pubblica.',
    ])
  })

  it('«fatta il» che non legge: la scadenza resta da fare, e lo dice', () => {
    const { list, warnings } = read([{ ...base, 'fatta il': 'sì' }])
    expect(list[0]?.doneOn).toBeNull()
    expect(warnings).toEqual([
      '«Scadenze», riga 2: la data «sì» in «fatta il» non la leggo: la scadenza resta da fare.',
    ])
  })

  it('un nome in «chi segue» non esce: avvisa, e la scadenza risulta senza nessuno', () => {
    const { list, warnings } = read([{ ...base, 'chi segue (ruolo)': 'Mario Rossi' }])
    expect(list[0]?.ownerRole).toBe('')
    expect(warnings).toEqual([
      '«Scadenze», riga 2: «chi segue (ruolo)» dice «Mario Rossi»: scrivi un ruolo, come «il tesoriere» o ' +
        '«una persona di Struttura», mai un nome. Intanto esce come «Nessuno la segue».',
    ])
  })

  it('in «chi segue» vale il nome di un gruppo della scheda «Gruppi»', () => {
    const warnings: string[] = []
    const row = { ...base, 'chi segue (ruolo)': 'una persona di Orti e Suoli' }
    const list = readDeadlines(table(SHEETS.deadlines, [row]), romeDate, warnings, ['Orti e Suoli'])
    expect(list[0]?.ownerRole).toBe('una persona di Orti e Suoli')
    expect(warnings).toEqual([])
  })

  it('una data che non esiste, come il 30 febbraio, non si legge', () => {
    const { list, warnings } = read([{ ...base, data: '30/02/2026' }])
    expect(list).toEqual([])
    expect(warnings).toEqual([
      '«Scadenze», riga 2: la data «30/02/2026» in «data» non la leggo, la scadenza non si pubblica.',
    ])
  })
})

describe('readResolutions', () => {
  const read = (rows: Record<string, unknown>[]) => {
    const warnings: string[] = []
    return { list: readResolutions(table(SHEETS.resolutions, rows), romeDate, warnings), warnings }
  }
  const base = {
    data: '2026-10-10',
    organo: 'Direttivo',
    oggetto: 'Via alla Bussola',
    'link al verbale': 'https://drive.google.com/file/d/v1/view',
  }

  it('legge una delibera coi campi della Riservata', () => {
    const { list, warnings } = read([{ ...base, 'ratificata il': '20/10/2026' }])
    expect(list).toEqual([
      {
        date: '2026-10-10',
        body: 'Direttivo',
        subject: 'Via alla Bussola',
        minutesUrl: 'https://drive.google.com/file/d/v1/view',
        ratifiedOn: '2026-10-20',
      },
    ])
    expect(warnings).toEqual([])
  })

  it('senza link al verbale esce senza, in silenzio', () => {
    const { list, warnings } = read([{ ...base, 'link al verbale': '' }])
    expect(list[0]?.minutesUrl).toBeNull()
    expect(warnings).toEqual([])
  })

  it('un link che non porta al Drive non esce, e lo dice', () => {
    const { list, warnings } = read([{ ...base, 'link al verbale': 'https://example.org/verbale.pdf' }])
    expect(list[0]?.minutesUrl).toBeNull()
    expect(warnings).toEqual([
      '«Delibere», riga 2: il «link al verbale» non porta al Drive: la delibera esce senza verbale.',
    ])
  })

  it('senza data, con una data che non legge o senza oggetto non si pubblica, e lo dice', () => {
    const { list, warnings } = read([
      { ...base, data: '' },
      { ...base, data: 'ottobre' },
      { ...base, oggetto: '' },
    ])
    expect(list).toEqual([])
    expect(warnings).toEqual([
      '«Delibere», riga 2: manca la data, la delibera non si pubblica.',
      '«Delibere», riga 3: la data «ottobre» in «data» non la leggo, la delibera non si pubblica.',
      '«Delibere», riga 4: manca l’oggetto, la delibera non si pubblica.',
    ])
  })

  it('«ratificata il» che non legge: la delibera esce come non ratificata, e lo dice', () => {
    const { list, warnings } = read([{ ...base, 'ratificata il': 'presto' }])
    expect(list[0]?.ratifiedOn).toBeNull()
    expect(warnings).toEqual([
      '«Delibere», riga 2: la data «presto» in «ratificata il» non la leggo: la delibera esce come non ratificata.',
    ])
  })
})

describe('readIssues', () => {
  const read = (rows: Record<string, unknown>[]) => {
    const warnings: string[] = []
    return { list: readIssues(table(SHEETS.issues, rows), romeDate, warnings), warnings }
  }
  const base = { cosa: 'Diritti dei sostenitori', 'da quando': '2026-09-01', 'chi (ruolo)': 'il Direttivo' }

  it('legge le aperte, anche con lo stato vuoto, e non le chiuse', () => {
    const { list, warnings } = read([
      { ...base, stato: 'aperta' },
      { ...base, cosa: 'Codice etico', stato: '' },
      { ...base, cosa: 'Service audio', stato: 'Chiusa' },
    ])
    expect(list).toEqual([
      { what: 'Diritti dei sostenitori', since: '2026-09-01', ownerRole: 'il Direttivo' },
      { what: 'Codice etico', since: '2026-09-01', ownerRole: 'il Direttivo' },
    ])
    expect(warnings).toEqual([])
  })

  it('uno stato che non conosce, o una questione senza «cosa», non si pubblica, e lo dice', () => {
    const { list, warnings } = read([
      { ...base, stato: 'sospesa' },
      { ...base, cosa: '' },
    ])
    expect(list).toEqual([])
    expect(warnings).toEqual([
      '«Questioni», riga 2: lo stato «sospesa» non lo conosco, la questione non si pubblica.',
      '«Questioni», riga 3: manca «cosa», la questione non si pubblica.',
    ])
  })

  it('«da quando» che non legge esce vuoto, e lo dice; un nome in «chi» non esce', () => {
    const { list, warnings } = read([{ ...base, 'da quando': 'da sempre', 'chi (ruolo)': 'Anna' }])
    expect(list).toEqual([{ what: 'Diritti dei sostenitori', since: null, ownerRole: '' }])
    expect(warnings).toEqual([
      '«Questioni», riga 2: la data «da sempre» in «da quando» non la leggo: esce senza data.',
      '«Questioni», riga 2: «chi (ruolo)» dice «Anna»: scrivi un ruolo, come «il tesoriere» o ' +
        '«una persona di Struttura», mai un nome. Intanto esce come «Nessuno la segue».',
    ])
  })
})

describe('readAmount', () => {
  it('un numero del Foglio resta quello', () => {
    expect(readAmount(4771.5)).toBe(4771.5)
    expect(readAmount(0)).toBe(0)
  })

  it('vuoto è null', () => {
    expect(readAmount('')).toBeNull()
    expect(readAmount(null)).toBeNull()
  })

  it('legge le cifre scritte all’italiana, con l’euro e gli spazi', () => {
    expect(readAmount('1.200,50 €')).toBe(1200.5)
    expect(readAmount('€ 27.780')).toBe(27780)
    expect(readAmount('1200')).toBe(1200)
    expect(readAmount('1200,5')).toBe(1200.5)
    expect(readAmount('1\u00a0200')).toBe(1200)
  })

  it('una cifra che non legge, o negativa, è undefined', () => {
    for (const value of ['tanti', '12.5', '1.20', '-300', -300, '1,2,3', Number.NaN])
      expect(readAmount(value), String(value)).toBeUndefined()
  })
})

describe('readBudget', () => {
  const read = (rows: Record<string, unknown>[]) => {
    const warnings: string[] = []
    return { budget: readBudget(table(SHEETS.budget, rows), romeDate, warnings), warnings }
  }

  it('legge le righe nell’ordine del Foglio, con l’ultima data di aggiornamento', () => {
    const { budget, warnings } = read([
      { voce: 'Webinar', previsto: 5000, speso: '1.200', 'aggiornato il': '2026-10-01' },
      { voce: 'Sito', previsto: 500, speso: 500, 'aggiornato il': '12/10/2026' },
      { voce: 'Raduno', previsto: '4.771,50', speso: '', 'aggiornato il': '' },
    ])
    expect(budget).toEqual({
      updatedOn: '2026-10-12',
      lines: [
        { label: 'Webinar', planned: 5000, spent: 1200 },
        { label: 'Sito', planned: 500, spent: 500 },
        { label: 'Raduno', planned: 4771.5, spent: null },
      ],
    })
    expect(warnings).toEqual([])
  })

  it('una voce senza numeri è una riga preparata: si salta in silenzio', () => {
    const { budget, warnings } = read([{ voce: 'Raduno' }])
    expect(budget).toEqual({ updatedOn: null, lines: [] })
    expect(warnings).toEqual([])
  })

  it('numeri senza voce non si pubblicano, e lo dice', () => {
    const { budget, warnings } = read([{ voce: '', previsto: 300 }])
    expect(budget.lines).toEqual([])
    expect(warnings).toEqual(['«Budget», riga 2: ci sono dei numeri ma manca la voce, la riga non si pubblica.'])
  })

  it('una cifra o una data che non legge esce vuota, e lo dice', () => {
    const { budget, warnings } = read([{ voce: 'Sito', previsto: 'cinquecento', speso: 0, 'aggiornato il': 'ieri' }])
    expect(budget).toEqual({ updatedOn: null, lines: [{ label: 'Sito', planned: null, spent: 0 }] })
    expect(warnings).toEqual([
      '«Budget», riga 2: la cifra «cinquecento» in «previsto» non la leggo: esce vuota.',
      '«Budget», riga 2: la data «ieri» in «aggiornato il» non la leggo.',
    ])
  })
})

describe('le schede del sito (T7)', () => {
  const groups = [
    { id: 'GDL-orti', name: 'Orti e Suoli' },
    { id: 'GDL-semi', name: 'Semi e Biodiversità' },
  ]
  const table = (spec: SheetSpec, rows: Record<string, unknown>[]) =>
    readTable(
      memoryWorkbook({ [spec.name]: [[...spec.columns], ...rows.map((row) => spec.columns.map((c) => row[c] ?? ''))] }),
      spec,
    )

  it('una scheda che manca non ferma il giro: lo dice l’avviso', () => {
    const warnings: string[] = []
    expect(readOptionalTable(memoryWorkbook({}), SHEETS.referents, warnings)).toBeNull()
    expect(warnings).toEqual(['Manca la scheda «Referenti»: la crea setupBussola, dall’editor.'])
  })

  it('nemmeno una colonna che manca: la scheda non si legge, e l’avviso dice quale', () => {
    const warnings: string[] = []
    const workbook = memoryWorkbook({ Referenti: [['GdL', 'nome da mostrare', 'ruolo']] })
    expect(readOptionalTable(workbook, SHEETS.referents, warnings)).toBeNull()
    expect(warnings).toEqual([
      '«Referenti»: manca la colonna «consenso dal». Finché non c’è, ciò che porta la scheda non esce sul sito.',
    ])
  })

  it('sì e no come si scrivono nel Foglio', () => {
    expect(['Sì', 'si', true, 'VERO'].map(readYesNo)).toEqual([true, true, true, true])
    expect(['No', '', false, null].map(readYesNo)).toEqual([false, false, false, false])
    expect(readYesNo('forse')).toBeUndefined()
  })

  it('i GdL: missione, come si partecipa, dove e quando; la chat solo se aperta ai soci', () => {
    const warnings: string[] = []
    const read = readGroups(
      table(SHEETS.groups, [
        {
          id: 'GDL-orti',
          nome: 'Orti',
          missione: 'Orti vivi.',
          'link della chat': 'https://chat.example.org/o',
          'chat aperta ai soci': 'sì',
        },
        { id: 'GDL-semi', nome: 'Semi', 'link della chat': 'https://chat.example.org/s', 'chat aperta ai soci': 'no' },
        { id: 'GDL-x', nome: 'X', 'link della chat': 'https://wa.me/393331234567', 'chat aperta ai soci': 'sì' },
      ]),
      warnings,
    )
    expect(read.map((group) => group.chatUrl)).toEqual(['https://chat.example.org/o', null, null])
    expect(read[0]?.mission).toBe('Orti vivi.')
    expect(warnings).toEqual(['«GdL», riga 4: il «link della chat» non è un link https che si apre: non esce.'])
  })

  it('una scheda «GdL» senza «chat aperta ai soci» tiene chiuse le chat, e lo dice', () => {
    const warnings: string[] = []
    const workbook = memoryWorkbook({
      GdL: [
        ['id', 'nome', 'link della chat', 'codice del gruppo'],
        ['GDL-orti', 'Orti', 'https://chat.example.org/o', 'k1'],
      ],
    })
    expect(readGroups(readTable(workbook, SHEETS.groups), warnings)[0]?.chatUrl).toBeNull()
    expect(warnings[0]).toContain('manca la colonna «chat aperta ai soci»')
  })

  describe('readReferents', () => {
    const read = (rows: Record<string, unknown>[], warnings: string[] = []) =>
      readReferents(table(SHEETS.referents, rows), romeDate, warnings, groups)

    it('legge GdL (id o nome), nome, ruolo e consenso; la mail per la Riservata no', () => {
      const referents = read([
        {
          GdL: 'Orti e Suoli',
          'numero socio': 34,
          'nome da mostrare': 'Lia Prova',
          ruolo: 'referente',
          'consenso dal': '2026-10-01',
          'mail per la Riservata': 'lia.prova@example.org',
        },
        { GdL: 'GDL-semi', 'nome da mostrare': 'Teo Finto', ruolo: 'co-referente', 'consenso dal': '' },
      ])
      expect(referents).toEqual([
        { groupId: 'GDL-orti', name: 'Lia Prova', role: 'referente', consentSince: '2026-10-01' },
        { groupId: 'GDL-semi', name: 'Teo Finto', role: 'co-referente', consentSince: null },
      ])
      expect(JSON.stringify(referents)).not.toContain('example.org')
    })

    it('un ruolo che porta un nome esce come «referente», con l’avviso', () => {
      const warnings: string[] = []
      const [referent] = read(
        [{ GdL: 'GDL-orti', 'nome da mostrare': 'Lia', ruolo: 'referente Lia Prova', 'consenso dal': '' }],
        warnings,
      )
      expect(referent?.role).toBe('referente')
      expect(warnings[0]).toContain('«Lia» sembra un nome')
    })

    it('un nome al primo posto del ruolo non esce: il ruolo comincia con la parola del ruolo', () => {
      const warnings: string[] = []
      const roles = ['Lia referente', 'Mario', 'Bruno, co-referente'].map((ruolo) => ({
        GdL: 'GDL-orti',
        'nome da mostrare': 'X',
        ruolo,
        'consenso dal': '',
      }))
      expect(read(roles, warnings).map((referent) => referent.role)).toEqual(['referente', 'referente', 'referente'])
      expect(warnings).toHaveLength(3)
      expect(warnings[0]).toContain('«Lia» non è la parola di un ruolo')
    })

    it('i ruoli come si scrivono passano, anche con la maiuscola o l’articolo', () => {
      const warnings: string[] = []
      const roles = ['Referente', 'co-referente', 'rappresentante nel Coordinamento', 'la referente', 'Portavoce']
      const referents = read(
        roles.map((ruolo) => ({ GdL: 'GDL-orti', 'nome da mostrare': 'X', ruolo, 'consenso dal': '' })),
        warnings,
      )
      expect(referents.map((referent) => referent.role)).toEqual(roles)
      expect(warnings).toEqual([])
    })

    it('un GdL che non c’è, o un consenso che non si legge, si dicono', () => {
      const warnings: string[] = []
      const referents = read(
        [
          { GdL: 'Gruppo inventato', 'nome da mostrare': 'A', ruolo: 'referente', 'consenso dal': '2026-10-01' },
          { GdL: 'GDL-orti', 'nome da mostrare': 'B', ruolo: 'referente', 'consenso dal': 'ieri' },
        ],
        warnings,
      )
      expect(referents).toEqual([{ groupId: 'GDL-orti', name: 'B', role: 'referente', consentSince: null }])
      expect(warnings).toHaveLength(2)
      expect(warnings[1]).toContain('il nome non esce')
    })
  })

  describe('readMeetings', () => {
    const read = (rows: Record<string, unknown>[], warnings: string[] = []) =>
      readMeetings(table(SHEETS.meetings, rows), romeDateTime, warnings, groups, 'da controllare')
    const meet = 'https://meet.google.com/abc-defg-hij'

    it('legge giorno e ora scritti a mano o come li dà Google, all’ora di Roma', () => {
      expect(
        read([
          { GdL: 'GDL-orti', 'data e ora': '05/11/2026 18:30', 'link Meet': meet, 'visibile ai soci': 'sì' },
          {
            GdL: 'Coordinamento',
            'data e ora': new Date('2026-11-06T19:00:00Z'),
            'link Meet': meet,
            'visibile ai soci': 'no',
          },
          { GdL: 'Semi e Biodiversità', 'data e ora': '2026-11-07 9:00', 'link Meet': meet },
        ]),
      ).toEqual([
        { groupId: 'GDL-orti', startsAt: '2026-11-05T18:30', meetUrl: meet, membersCanSee: true },
        { groupId: 'Coordinamento', startsAt: '2026-11-06T20:00', meetUrl: meet, membersCanSee: false },
        { groupId: 'GDL-semi', startsAt: '2026-11-07T09:00', meetUrl: meet, membersCanSee: false },
      ])
    })

    it('una data senza ora, che il Foglio scrive a mezzanotte, non esce: manca l’ora', () => {
      const warnings: string[] = []
      // «05/11/2026» scritto a mano: il Foglio ne fa la mezzanotte di Roma.
      const midnight = new Date('2026-11-04T23:00:00Z')
      expect(
        read([{ GdL: 'GDL-orti', 'data e ora': midnight, 'link Meet': meet, 'visibile ai soci': 'sì' }], warnings),
      ).toEqual([])
      expect(warnings[0]).toContain('manca l’ora')
      expect(readLocalDateTime(midnight, romeDateTime)).toBeUndefined()
    })

    it('senza Meet, con la data sbagliata o «da controllare» non esce', () => {
      const warnings: string[] = []
      const meetings = read(
        [
          { GdL: 'GDL-orti', 'data e ora': '05/11/2026 18:30', 'link Meet': 'https://zoom.us/j/1' },
          { GdL: 'GDL-orti', 'data e ora': 'giovedì', 'link Meet': meet },
          {
            GdL: 'GDL-orti',
            'data e ora': '05/11/2026 18:30',
            'link Meet': meet,
            'esito del controllo': 'da controllare: codice',
          },
        ],
        warnings,
      )
      expect(meetings).toEqual([])
      expect(warnings).toHaveLength(2)
    })

    it('lo scritto a mano', () => {
      expect(readLocalDateTime('2026-11-05T18:30', romeDateTime)).toBe('2026-11-05T18:30')
      expect(readLocalDateTime('5/11/2026 18.30', romeDateTime)).toBe('2026-11-05T18:30')
      expect(readLocalDateTime('', romeDateTime)).toBeNull()
      expect(readLocalDateTime('31/02/2026 18:30', romeDateTime)).toBeUndefined()
    })
  })

  describe('readLinks', () => {
    it('ognuno con chi lo può aprire; il GdL solo per i partecipanti di un GdL', () => {
      const warnings: string[] = []
      const links = readLinks(
        table(SHEETS.links, [
          { titolo: 'Calendario', link: 'https://calendar.example.org', 'chi lo può aprire': 'tutti', GdL: 'GDL-orti' },
          {
            titolo: 'Cartella',
            link: 'https://drive.google.com/x',
            'chi lo può aprire': 'partecipanti del GdL',
            GdL: 'Orti e Suoli',
          },
          { titolo: 'Verbali', link: 'https://drive.google.com/y', 'chi lo può aprire': 'Coordinamento' },
          { titolo: 'Telefono', link: 'https://wa.me/393331234567', 'chi lo può aprire': 'soci' },
          { titolo: 'Senza gruppo', link: 'https://drive.google.com/z', 'chi lo può aprire': 'GdL' },
          { titolo: 'Boh', link: 'https://drive.google.com/z', 'chi lo può aprire': 'amici' },
        ]),
        warnings,
        groups,
      )
      expect(links).toEqual([
        { title: 'Calendario', url: 'https://calendar.example.org', audience: 'all', groupId: null },
        { title: 'Cartella', url: 'https://drive.google.com/x', audience: 'group', groupId: 'GDL-orti' },
        { title: 'Verbali', url: 'https://drive.google.com/y', audience: 'coordination', groupId: null },
      ])
      expect(warnings).toHaveLength(3)
    })
  })

  it('il primo giorno: i passi nell’ordine delle righe', () => {
    const warnings: string[] = []
    expect(
      readFirstDay(
        table(SHEETS.firstDay, [
          { titolo: 'Scegli un gruppo', testo: 'Guarda i Gruppi.' },
          { titolo: 'Scrivi', testo: 'Al referente.', link: 'mailto:x@example.org' },
          { testo: 'senza titolo' },
        ]),
        warnings,
      ),
    ).toEqual([
      { title: 'Scegli un gruppo', text: 'Guarda i Gruppi.', url: null },
      { title: 'Scrivi', text: 'Al referente.', url: null },
    ])
    expect(warnings).toHaveLength(2)
  })

  it('le scadenze dicono se sono visibili ai soci; vuoto vale no', () => {
    const deadlines = readDeadlines(readTable(memoryWorkbook(demoSheets(now)), SHEETS.deadlines), romeDate, [])
    expect(deadlines.filter((deadline) => deadline.membersCanSee).map((deadline) => deadline.id)).toEqual([
      'SCA-0002',
      'SCA-0005',
      'SCA-0009',
      'SCA-0010',
    ])
  })

  it('il link della segreteria in «Impostazioni»: una mail non va', () => {
    const settings = (value: string, warnings: string[] = []) =>
      readSettings(
        readTable(
          memoryWorkbook({
            Impostazioni: [
              ['voce', 'valore'],
              ['link della segreteria', value],
            ],
          }),
          SHEETS.settings,
        ),
        warnings,
      ).officeUrl
    expect(settings('https://docs.google.com/forms/d/e/x/viewform')).toBe(
      'https://docs.google.com/forms/d/e/x/viewform',
    )
    const warnings: string[] = []
    expect(settings('mailto:segreteria@example.org', warnings)).toBeNull()
    expect(warnings).toHaveLength(1)
  })
})
