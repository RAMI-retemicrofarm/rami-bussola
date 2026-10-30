import { MEMBER_STATUSES, statusLabel } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { OFFICE_CALLS } from './office-api.ts'
import { OFFICE_PAGE_WORDS, officePageHtml } from './office-page.ts'

const html = officePageHtml()
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '')
const script = scripts[0] ?? ''

describe('officePageHtml', () => {
  it('è un documento intero, in italiano', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="it">')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('la fascia «Solo segretario…» sta nell’header con la testata: niente testo fuori dai landmark', () => {
    // Fra <body> e <main> c'è solo l'header: chi si muove fra i landmark incontra anche la fascia (regola «region»).
    const top = /<body>\n([\s\S]*?)\n<main id="main">/.exec(html)?.[1] ?? ''
    expect(top).toMatch(/^<header>[\s\S]*<\/header>$/)
    expect(top.match(/<header\b/g)).toHaveLength(1)
    expect(top).toContain('Solo segretario, segreteria part-time e tesoriere</div></header>')
    // Il marchio resta il primo elemento: il Tab delle prove riparte da lì.
    expect(top).toMatch(/^<header><div class="testata"><p class="marchio">/)
  })

  it('arriva con lo scheletro, prima dei dati', () => {
    expect(html).toContain('Sto aprendo la segreteria…')
  })

  it('la freccia degli elenchi chiusi è decorativa: il lettore di schermo legge solo «Iscrizioni al Raduno: 3»', () => {
    expect(html).toContain('details.altre summary::before { content: "›" / "";')
  })

  it('ha un solo script, scritto per il browser, che si legge senza errori', () => {
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(scripts).toHaveLength(1)
    // Solo la sintassi: `new Function` lo legge senza eseguirlo.
    expect(() => new Function(script)).not.toThrow()
  })

  it('non carica niente da fuori: niente link, src o indirizzi http', () => {
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<link\b|\bsrc=|@import|url\(/)
  })

  it('chiama solo le funzioni del contratto, tutte, e ogni chiamata ha il suo failure handler', () => {
    const called = new Set([...script.matchAll(/\bcall\("(\w+)"/g)].map((match) => match[1]))
    expect([...called].sort()).toEqual([...OFFICE_CALLS].sort())
    expect(script.match(/google\.script\.run/g)).toHaveLength(1)
    expect(script).toContain('.withFailureHandler(')
  })

  it('non usa alert, confirm né prompt', () => {
    expect(script).not.toMatch(/\b(alert|confirm|prompt)\(/)
  })

  it('scrive gli stati con le stesse parole delle regole delle quote', () => {
    for (const status of MEMBER_STATUSES) {
      const label = statusLabel(status, 2026).replace('2027', '')
      expect(script).toContain(`"${label}`)
    }
  })

  it('ricorda il «Chi sei?» sul dispositivo con la sua chiave, sempre dentro un try', () => {
    expect(script).toContain('"bussola.segreteria.chiSei"')
    const uses = script.match(/localStorage\./g) ?? []
    const guarded = script.match(/try \{ (return )?localStorage\./g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    expect(guarded).toHaveLength(uses.length)
  })
})

// Le parole della pagina sono funzioni pure, senza DOM: si leggono dal loro blocco e si provano una per una.
type Words = {
  accessChangeText: (change: { when: string; who: string; cells: string; before: string; after: string }) => string
  sharingWarning: (checkedOn: string, today: string) => string
  revokeAdvice: (finding: { where: string; account: string }) => string
  emptySearchText: (query: string, filterLabel: string) => string
  outcomeLine: (result: {
    payment: { memberNumber: string; validYear: number }
    memberName: string
    pending: boolean
    status: string | null
  }) => [string, string, string]
  noAccessText: (email: string) => string
  EMPTY: Record<'toMatch' | 'toCheck' | 'pending' | 'cash' | 'deadlines' | 'health', string>
  lastRecordingLine: (last: { id: string; on: string; daysAgo: number } | null) => [string, string, string]
  renewalsLine: (r: { percent: number } | null, label: string) => [string, string, string]
  deadlineLine: (d: {
    lateByDays: number | null
    overdueByDays: number | null
    daysLeft: number
  }) => [string, string, string]
  toMatchText: (item: unknown) => string
  cashTotalText: (cash: { payments: unknown[]; total: number }) => string
  pendingCountText: (n: number) => string
  toMatchCountText: (n: number) => string
  registerText: (r: { savedOn: string }) => string
  registerWarning: (r: { savedOn: string; failedOn: string; error: string }) => string
  publicationWarning: (p: { pendingSince: string; error: string }) => string
  healthMark: (status: string) => [string, string]
  importedText: (r: { added: number; matched: number; ignored: number; alreadyPasted: number }) => string
  commitmentsToWriteText: (n: number | null) => string
  setAsideCountText: (kind: 'raduno' | 'notDues', n: number) => string
  setAsideText: (item: { line: unknown; why: string }, withWhy: boolean) => string
  notDuesDoneText: (line: unknown, reason: string) => string
  setAsideNoteText: (kind: 'raduno' | 'notDues') => string
  bankSummaryText: (
    bank: { lines: number; outflows: number; lastDate: string; raduno: unknown[]; notDues: unknown[] },
    matched: number,
  ) => string
}
const words = new Function(
  `"use strict"\n${OFFICE_PAGE_WORDS}\nreturn { accessChangeText, sharingWarning, revokeAdvice, emptySearchText, outcomeLine, noAccessText, EMPTY, lastRecordingLine, renewalsLine, deadlineLine, toMatchText, cashTotalText, pendingCountText, toMatchCountText, registerText, registerWarning, publicationWarning, healthMark, importedText, commitmentsToWriteText, setAsideCountText, setAsideText, notDuesDoneText, setAsideNoteText, bankSummaryText }`,
)() as Words

describe('le parole della pagina', () => {
  it('sono dentro lo script della pagina', () => {
    expect(script).toContain(OFFICE_PAGE_WORDS)
  })

  const change = {
    when: '26/10/2026 16:40',
    who: 'segreteria@example.org',
    cells: 'A4:F4',
    before: '',
    after: 'Ugo Bassi · condiviso@example.org',
  }

  it('un cambio di «Accessi» è una frase sola, con la riga e chi l’ha fatto', () => {
    expect(words.accessChangeText(change)).toBe(
      "26/10 alle 16:40 la riga 4 di «Accessi» è cambiata: ora «Ugo Bassi · condiviso@example.org». L'ha fatto segreteria@example.org.",
    )
  })

  it('più righe insieme: «le righe 4–5»; svuotate: «ora vuote»', () => {
    expect(words.accessChangeText({ ...change, cells: 'A4:F5', after: '' })).toBe(
      "26/10 alle 16:40 le righe 4–5 di «Accessi» sono cambiate: ora vuote. L'ha fatto segreteria@example.org.",
    )
  })

  it('una cella sola ha anche il valore di prima, e vuota si dice', () => {
    expect(words.accessChangeText({ ...change, cells: 'D5', before: 'sì', after: 'no' })).toBe(
      "26/10 alle 16:40 la riga 5 di «Accessi» è cambiata: prima «sì», ora «no». L'ha fatto segreteria@example.org.",
    )
    expect(words.accessChangeText({ ...change, cells: 'B7', before: '', after: 'x@example.org' })).toContain(
      'prima vuota, ora «x@example.org»',
    )
  })

  it('celle che non si leggono e chi non è noto restano dette come sono', () => {
    expect(words.accessChangeText({ ...change, when: 'ieri', cells: 'A:A', who: 'non noto' })).toBe(
      "ieri le celle A:A di «Accessi» sono cambiate: ora «Ugo Bassi · condiviso@example.org». Non si sa chi l'ha fatto.",
    )
  })

  it('il controllo delle condivisioni: avviso oltre due giorni, o se non ha mai girato', () => {
    expect(words.sharingWarning('2026-11-03', '2026-11-05')).toBe('')
    expect(words.sharingWarning('2026-11-02', '2026-11-05')).toBe(
      'Il controllo delle condivisioni non gira dal 02/11/2026: avvisa chi cura la Bussola.',
    )
    expect(words.sharingWarning('2026-10-30', '2026-11-02')).toContain('dal 30/10/2026')
    expect(words.sharingWarning('', '2026-11-05')).toBe(
      'Il controllo delle condivisioni non ha ancora girato: avvisa chi cura la Bussola.',
    )
  })

  it('cosa fare di una condivisione fuori dall’elenco, col posto giusto', () => {
    expect(words.revokeAdvice({ where: 'il Foglio soci', account: 'qualcuno@example.org' })).toBe(
      "Togli l'accesso dal Foglio soci, oppure aggiungi la persona in «Accessi».",
    )
    expect(words.revokeAdvice({ where: 'la cartella «Bussola»', account: 'q@example.org' })).toContain(
      'dalla cartella «Bussola»,',
    )
    expect(words.revokeAdvice({ where: 'il Foglio soci', account: 'chiunque abbia il link' })).toBe(
      "Togli l'accesso dal Foglio soci.",
    )
  })

  it('la ricerca vuota dice il filtro acceso, e come uscirne', () => {
    expect(words.emptySearchText('Zanetti', '')).toBe('Nessun socio con «Zanetti».')
    expect(words.emptySearchText(' neri ', 'Da rinnovare')).toBe(
      'Nessun socio con «neri» fra quelli «Da rinnovare». Tocca «Tutti» per cercare fra tutti.',
    )
    expect(words.emptySearchText('', 'In regola')).toBe('Nessun socio in questo elenco.')
  })

  it('la conferma dice «in regola» solo se il socio lo è', () => {
    const recorded = (status: string | null, validYear = 2026) => ({
      payment: { memberNumber: '5', validYear },
      memberName: 'Anna Esposito',
      pending: false,
      status,
    })
    expect(words.outcomeLine(recorded('inGoodStanding'))).toEqual([
      'Registrato. Anna Esposito è in regola per il 2026.',
      'ok',
      'dot pieno',
    ])
    expect(words.outcomeLine(recorded('paidAhead', 2027))[0]).toBe('Registrato. Anna Esposito è in regola per il 2027.')
    expect(words.outcomeLine(recorded('left'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Receduto».',
    )
    expect(words.outcomeLine(recorded('dueForRenewal'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Da rinnovare».',
    )
    expect(words.outcomeLine(recorded('notInGoodStanding'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Non in regola».',
    )
    expect(words.outcomeLine({ ...recorded('left'), pending: true })[0]).toBe(
      'Registrato. Il pagamento è in attesa del tesoriere: conta quando lo conferma.',
    )
    expect(words.outcomeLine({ ...recorded(null), payment: { memberNumber: '', validYear: 2026 } })[0]).toBe(
      'Registrato senza socio: va in «Da abbinare».',
    )
  })

  it('«Non hai accesso» dice l’account in uso, se c’è', () => {
    expect(words.noAccessText('curioso@example.org')).toBe(
      "Stai usando l'account curioso@example.org. Entra con quello della segreteria: se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a chi cura la Bussola.",
    )
    expect(words.noAccessText('')).toBe(
      "Entra con l'account della segreteria: se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a chi cura la Bussola.",
    )
  })
})

describe('le parole di «Oggi» e di Pagamenti', () => {
  it('gli impegni da scrivere, in una riga; senza la scheda «Impegni» niente', () => {
    expect(words.commitmentsToWriteText(2)).toBe('Impegni da scrivere: 2')
    expect(words.commitmentsToWriteText(0)).toBe('Impegni da scrivere: 0')
    expect(words.commitmentsToWriteText(null)).toBe('')
  })

  it('le pagine vuote dicono le frasi del criterio', () => {
    expect(words.EMPTY.toMatch).toBe('Niente da abbinare: banca e registro tornano.')
    expect(words.EMPTY.toCheck).toBe('Niente da controllare.')
    expect(words.EMPTY.pending).toBe('Nessun pagamento in attesa del tesoriere.')
    expect(words.toMatchCountText(0)).toBe('Niente da abbinare: banca e registro tornano.')
    expect(words.pendingCountText(0)).toBe('Nessun pagamento in attesa del tesoriere.')
    expect(words.cashTotalText({ payments: [], total: 0 })).toBe('Nessun contante da consegnare.')
  })

  it('l’ultima registrazione: verde entro 7 giorni, rossa e a parole oltre', () => {
    expect(words.lastRecordingLine({ id: 'P-2026-0007', on: '2026-10-30', daysAgo: 6 })).toEqual([
      'Ultima registrazione: P-2026-0007 del 30/10/2026, 6 giorni fa.',
      'ok',
      'dot pieno',
    ])
    expect(words.lastRecordingLine({ id: 'P-2026-0007', on: '2026-11-05', daysAgo: 0 })[0]).toContain(', oggi.')
    expect(words.lastRecordingLine({ id: 'P-2026-0007', on: '2026-11-04', daysAgo: 1 })[0]).toContain(', ieri.')
    expect(words.lastRecordingLine({ id: 'P-2026-0007', on: '2026-10-29', daysAgo: 7 })[1]).toBe('ok')
    expect(words.lastRecordingLine({ id: 'P-2026-0007', on: '2026-10-28', daysAgo: 8 })).toEqual([
      "Nessuna registrazione da 8 giorni: l'ultima è P-2026-0007 del 28/10/2026.",
      'bad',
      'tri',
    ])
    expect(words.lastRecordingLine(null)).toEqual(['Nessun pagamento registrato finora.', 'warn', 'dot'])
  })

  it('i rinnovi: verdi oltre il 92%, se no gialli', () => {
    const label = 'Rinnovi 2027: 150 su 260 (58%) · bersaglio: oltre il 92% al 31/3'
    expect(words.renewalsLine({ percent: 58 }, label)).toEqual([label, 'warn', 'dot'])
    expect(words.renewalsLine({ percent: 93 }, label)[1]).toBe('ok')
    expect(words.renewalsLine({ percent: 92 }, label)[1]).toBe('warn')
  })

  it('una scadenza: in ritardo in rosso e a parole; una misura passata in giallo; le prossime a giorni', () => {
    expect(words.deadlineLine({ lateByDays: 3, overdueByDays: null, daysLeft: -3 })).toEqual([
      'In ritardo di 3 giorni',
      'bad',
      'tri',
    ])
    expect(words.deadlineLine({ lateByDays: 1, overdueByDays: null, daysLeft: -1 })[0]).toBe('In ritardo di 1 giorno')
    expect(words.deadlineLine({ lateByDays: null, overdueByDays: 5, daysLeft: -5 })).toEqual([
      'Passata da 5 giorni',
      'warn',
      'dot',
    ])
    expect(words.deadlineLine({ lateByDays: null, overdueByDays: null, daysLeft: 0 })[0]).toBe('Oggi')
    expect(words.deadlineLine({ lateByDays: null, overdueByDays: null, daysLeft: 1 })[0]).toBe('Domani')
    expect(words.deadlineLine({ lateByDays: null, overdueByDays: null, daysLeft: 12 })).toEqual([
      'Fra 12 giorni',
      'muto',
      'dot',
    ])
  })

  it('le voci di «Da abbinare», in una frase', () => {
    expect(
      words.toMatchText({
        kind: 'bankWithoutPayment',
        line: { date: '2026-11-02', amount: 30, reason: 'quota Verdi', reference: 'TRN 90210' },
        memberNumber: null,
      }),
    ).toBe('In banca il 02/11/2026: 30 €, «quota Verdi», rif. TRN 90210. Nessuna registrazione.')
    expect(
      words.toMatchText({
        kind: 'bankWithoutPayment',
        line: { date: '2026-11-02', amount: 30, reason: 'socio n. 9', reference: '' },
        memberNumber: '9',
      }),
    ).toBe('In banca il 02/11/2026: 30 €, «socio n. 9». Nessuna registrazione · nella causale: socio n. 9.')
    expect(
      words.toMatchText({
        kind: 'paymentWithoutBank',
        payment: { id: 'P-2026-0020', amount: 30, date: '2026-09-21' },
        daysAgo: 45,
      }),
    ).toBe("P-2026-0020, 30 € del 21/09/2026: bonifico registrato 45 giorni fa, in banca non c'è.")
    expect(
      words.toMatchText({
        kind: 'paymentWithoutMember',
        payment: { id: 'P-2026-0015', amount: 30, date: '2026-10-25', reference: '0015' },
      }),
    ).toBe('P-2026-0015, 30 € del 25/10/2026: registrato senza socio, rif. 0015.')
  })

  it('i contanti da consegnare col totale, e i conteggi', () => {
    expect(words.cashTotalText({ payments: [1, 2], total: 60 })).toBe('2 pagamenti in contanti da consegnare: 60 €')
    expect(words.cashTotalText({ payments: [1], total: 30.5 })).toBe('1 pagamento in contanti da consegnare: 30,50 €')
    expect(words.pendingCountText(1)).toBe('1 pagamento in attesa del tesoriere')
    expect(words.toMatchCountText(2)).toBe('2 da abbinare')
  })

  it('il libro soci nel Drive: la data, e la copia non riuscita', () => {
    expect(words.registerText({ savedOn: '2026-10-01' })).toBe('Ultimo libro soci nel Drive: 01/10/2026.')
    expect(words.registerText({ savedOn: '' })).toContain('Nessun libro soci nel Drive finora')
    expect(words.registerWarning({ savedOn: '2026-10-01', failedOn: '2026-11-01', error: 'Drive non risponde' })).toBe(
      'La copia del 01/11/2026 non è riuscita: Drive non risponde. Riprova con «Salva nel Drive»; se non va, avvisa chi cura la Bussola.',
    )
    expect(words.registerWarning({ savedOn: '2026-11-05', failedOn: '2026-11-01', error: 'x' })).toBe('')
    expect(words.registerWarning({ savedOn: '', failedOn: '', error: '' })).toBe('')
  })

  it('la pubblicazione dei numeri che non riesce si dice finché dura', () => {
    expect(words.publicationWarning({ pendingSince: '', error: '' })).toBe('')
    expect(words.publicationWarning({ pendingSince: '2026-11-05', error: 'KV ha risposto 503' })).toBe(
      'I numeri dei soci non arrivano alla Riservata dal 05/11/2026: riprovo a ogni giro. KV ha risposto 503',
    )
  })

  it('gli stati di «Salute» con colore e forma, e l’esito dell’importazione', () => {
    expect(words.healthMark('a posto')).toEqual(['ok', 'dot pieno'])
    expect(words.healthMark('ferma')).toEqual(['bad', 'tri'])
    expect(words.healthMark('da guardare')).toEqual(['warn', 'dot'])
    expect(words.importedText({ added: 3, matched: 2, ignored: 1, alreadyPasted: 1 })).toBe(
      'Estratto conto importato: 3 righe nuove, 2 abbinate, 1 ignorata, 1 già incollata, scartata.',
    )
    expect(words.importedText({ added: 0, matched: 0, ignored: 0, alreadyPasted: 4 })).toBe(
      'Estratto conto importato: 0 righe nuove, 4 già incollate, scartate.',
    )
  })

  it('la sintesi dell’estratto conto conta anche le iscrizioni al Raduno e le righe che non sono quote', () => {
    const bank = { lines: 4, outflows: 0, lastDate: '2026-11-02', raduno: [], notDues: [] }
    expect(words.bankSummaryText(bank, 3)).toBe('4 righe in «Estratto conto», 3 abbinate. Ultima riga: 02/11/2026.')
    expect(words.bankSummaryText({ ...bank, lines: 12, outflows: 2, raduno: [1, 2, 3], notDues: [1] }, 5)).toBe(
      '12 righe in «Estratto conto», 5 abbinate, 2 uscite, 3 iscrizioni al Raduno, 1 che non è una quota. Ultima riga: 02/11/2026.',
    )
    expect(words.bankSummaryText({ ...bank, lines: 3, raduno: [1], notDues: [1, 2], lastDate: '' }, 0)).toBe(
      '3 righe in «Estratto conto», 0 abbinate, 1 iscrizione al Raduno, 2 che non sono quote.',
    )
    expect(words.bankSummaryText({ ...bank, lines: 0 }, 0)).toBe('Nessuna riga della banca finora.')
  })

  it('le righe che non sono quote: il conteggio con la sua etichetta, una riga per bonifico col motivo, e l’esito', () => {
    expect(words.setAsideCountText('raduno', 3)).toBe('Iscrizioni al Raduno: 3')
    expect(words.setAsideCountText('notDues', 2)).toBe('Non sono quote: 2')
    const line = { index: 6, date: '2026-11-04', amount: 15, reason: 'magliette', reference: '' }
    // La riga del Foglio, con l'intestazione nella riga 1: è la cella da svuotare se il motivo è sbagliato.
    expect(words.setAsideText({ line, why: 'magliette per il banchetto' }, true)).toBe(
      'In banca il 04/11/2026: 15 €, «magliette». Motivo: magliette per il banchetto (riga 7).',
    )
    const raduno = {
      index: 3,
      date: '2026-11-03',
      amount: 45,
      reason: 'raduno rete microfarm 2027 (solo soci)',
      reference: 'CRO 701',
    }
    expect(words.setAsideText({ line: raduno, why: 'Iscrizione al Raduno' }, false)).toBe(
      'In banca il 03/11/2026: 45 €, «raduno rete microfarm 2027 (solo soci)», rif. CRO 701.',
    )
    expect(words.setAsideNoteText('raduno')).toBe(
      'Chi si iscrive al Raduno paga con un bonifico a parte: queste righe non sono quote e non si abbinano. Se una è una quota, registrala con «Registra un pagamento» e lo stesso riferimento; se non ha riferimento, nel Foglio soci apri la scheda «Estratto conto» e correggi la causale: torna fra le quote alla prossima apertura della Bussola.',
    )
    expect(words.setAsideNoteText('notDues')).toBe(
      'Le ha segnate chi registra. Se ti sbagli, nel Foglio soci apri la scheda «Estratto conto» e cancella la cella della colonna «ignorato perché» di quella riga: la riga torna in «Da abbinare» alla prossima apertura della Bussola.',
    )
    expect(words.notDuesDoneText(line, 'magliette')).toBe(
      'La riga del 04/11/2026 da 15 € ora è fra quelle che non sono quote: «magliette».',
    )
  })
})
