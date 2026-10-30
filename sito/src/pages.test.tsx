import { FINGERPRINT_VECTOR, normalizeEmail, RESERVED_KEY, type ReservedSnapshot } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './identity.ts'
import app from './index.tsx'
import { RiservataPage } from './riservata.tsx'
import { daysAgo, EMAILS, membersFixture, requestPage, reservedFixture, testEnv, visibleText } from './testing.ts'
import { formatDay, formatEuro } from './ui.tsx'

// In locale Access non c'è: chi entra lo dice la mail di prova, che vale solo su localhost.
async function page(path: string, email?: string, snapshot: ReservedSnapshot | null = reservedFixture()) {
  const res = await app.request(
    `http://localhost:8788${path}`,
    { headers: email ? { 'X-Bussola-Prova-Mail': email } : {} },
    testEnv(snapshot ? { [RESERVED_KEY]: snapshot } : {}),
  )
  return { res, html: await res.text() }
}

/** La scheda di un cantiere, dal titolo alla fine dell'articolo. */
const card = (html: string, title: string) => {
  const start = html.indexOf(`>${title}<`)
  return start < 0 ? '' : html.slice(start, html.indexOf('</article>', start))
}

/** Dove comincia il titolo di una sezione, con o senza l'id del salto; -1 se non c'è. */
const headingAt = (html: string, title: string) => {
  const at = html.indexOf(`>${title}</h2>`)
  return at < 0 ? -1 : html.lastIndexOf('<h2', at)
}

/** Una sezione della Riservata, dal suo titolo al titolo dopo; gli spazi che non vanno a capo diventano spazi. */
const section = (html: string, title: string) => {
  const start = headingAt(html, title)
  if (start < 0) return ''
  const end = html.indexOf('<h2', start + 1)
  return html.slice(start, end < 0 ? undefined : end).replace(/\u00a0/g, ' ')
}

const today = () => daysAgo(0)

describe('l’impronta delle mail nella vetrina', () => {
  it('torna col vettore di prova condiviso col motore', async () => {
    expect(await sha256Hex(normalizeEmail(FINGERPRINT_VECTOR.email))).toBe(FINGERPRINT_VECTOR.fingerprint)
  })
})

describe('/cantieri', () => {
  it('elenca i cantieri aperti, ognuno col suo gruppo', async () => {
    const { res, html } = await page('/cantieri', EMAILS.board)
    expect(res.status).toBe(200)
    expect(html).toContain('<h1>Cantieri</h1>')
    for (const title of ['Rete dei mercati contadini', 'Scambio di semi autunnale', 'Sito dei prodotti locali'])
      expect(html).toContain(title)
    expect(card(html, 'Scambio di semi autunnale')).toContain('GdL Semi e Biodiversità')
  })

  it('un cantiere «in corso» si legge «Passo 2 di 4»', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(card(html, 'Rete dei mercati contadini')).toContain('In corso')
    expect(card(html, 'Rete dei mercati contadini')).toContain('passo 2 di 4')
  })

  it('un cantiere «chiuso» esce dall’elenco', async () => {
    const snapshot = reservedFixture()
    const closed = { ...snapshot.projects[0], stage: 'closed', title: 'Orto didattico' }
    const { html } = await page('/cantieri', EMAILS.board, {
      ...snapshot,
      projects: [...snapshot.projects, closed],
    } as never)
    expect(html).not.toContain('Orto didattico')
  })

  it('aggiornato oggi dice «Aggiornato oggi»', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(card(html, 'Rete dei mercati contadini')).toContain('Aggiornato oggi')
  })

  it('fermo o in ritardo dice «Da aggiornare», coi giorni dall’ultimo aggiornamento', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(card(html, 'Sito dei prodotti locali')).toContain('Da aggiornare · 30 giorni fa')
    expect(card(html, 'Scambio di semi autunnale')).toContain('Da aggiornare · 20 giorni fa')
    expect(card(html, 'Orto condiviso')).toContain('Aggiornato 29 giorni fa')
  })

  it('la scadenza passata dice da quanti giorni', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(card(html, 'Scambio di semi autunnale')).toContain('passata da 10 giorni')
  })

  describe('il rappresentante', () => {
    it('vede «Aggiorna il tuo gruppo» sui cantieri del suo GdL, col Modulo precompilato', async () => {
      const { html } = await page('/cantieri', EMAILS.rep)
      const project = reservedFixture().projects[0]
      expect(card(html, 'Rete dei mercati contadini')).toContain('Aggiorna il tuo gruppo')
      expect(card(html, 'Rete dei mercati contadini')).toContain(`href="${project?.updateUrl?.replace(/&/g, '&amp;')}"`)
    })

    it('non lo vede sui cantieri degli altri gruppi', async () => {
      const { html } = await page('/cantieri', EMAILS.rep)
      expect(card(html, 'Scambio di semi autunnale')).not.toContain('Aggiorna il tuo gruppo')
    })

    it('vede di che gruppo è referente, e «Aggiungi un cantiere» col Modulo senza cantiere', async () => {
      const { html } = await page('/cantieri', EMAILS.rep)
      expect(html).toContain('Sei referente di: GdL Orti e Suoli')
      const group = reservedFixture().groups.find((candidate) => candidate.id === 'GDL-orti')
      expect(html).toContain(`href="${group?.newProjectUrl?.replace(/&/g, '&amp;')}"`)
      expect(html).toContain('Aggiungi un cantiere')
    })

    it('vede i cantieri del suo gruppo per primi', async () => {
      const { html } = await page('/cantieri', EMAILS.rep)
      expect(html.indexOf('Orto condiviso')).toBeLessThan(html.indexOf('Sito dei prodotti locali'))
    })

    it('se il gruppo non ha cantieri, lo dice', async () => {
      const snapshot = reservedFixture()
      const projects = snapshot.projects.filter((project) => project.groupId !== 'GDL-orti')
      const { html } = await page('/cantieri', EMAILS.rep, { ...snapshot, projects })
      expect(html).toContain('Questo gruppo non ha ancora cantieri.')
      expect(html).toContain('Aggiungi un cantiere')
    })
  })

  describe('i filtri', () => {
    /** I titoli dei cantieri sulla pagina, nell'ordine. */
    const titles = (html: string) => [...html.matchAll(/<h2 class="scheda-titolo">([^<]+)<\/h2>/g)].map((m) => m[1])
    /** Le voci dei filtri, coi loro indirizzi; quella scelta ha aria-current. */
    const filters = (html: string) =>
      [
        ...(html.match(/<nav class="filtri"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)</g),
      ].map((m) => [m[1]?.replace(/&amp;/g, '&'), m[3], m[2]?.includes('aria-current="page"')])

    it('Tutti e Da aggiornare per tutti; «Tutti» è scelto all’inizio', async () => {
      const { html } = await page('/cantieri', EMAILS.board)
      expect(filters(html)).toEqual([
        ['/cantieri', 'Tutti (4)', true],
        ['/cantieri?filtro=da-aggiornare', 'Da aggiornare (2)', false],
      ])
    })

    it('«Il mio gruppo» c’è per il rappresentante, e mostra solo i cantieri del suo GdL', async () => {
      const { html } = await page('/cantieri?filtro=mio', EMAILS.rep)
      expect(filters(html)).toEqual([
        ['/cantieri', 'Tutti (4)', false],
        ['/cantieri?filtro=mio', 'Il mio gruppo (2)', true],
        ['/cantieri?filtro=da-aggiornare', 'Da aggiornare (2)', false],
      ])
      expect(titles(html)).toEqual(['Orto condiviso', 'Rete dei mercati contadini'])
    })

    it('«Da aggiornare» mostra i cantieri fermi o in ritardo, e solo quelli', async () => {
      const { html } = await page('/cantieri?filtro=da-aggiornare', EMAILS.board)
      // In ritardo di 10 giorni il primo, fermo da 30 il secondo; aggiornati 29 giorni fa e oggi gli altri.
      expect(titles(html)).toEqual(['Sito dei prodotti locali', 'Scambio di semi autunnale'])
      expect(card(html, 'Sito dei prodotti locali')).toContain('Da aggiornare')
      expect(card(html, 'Scambio di semi autunnale')).toContain('Da aggiornare')
    })

    it('senza cantieri da aggiornare lo dice', async () => {
      const snapshot = reservedFixture()
      const projects = snapshot.projects.map((project) => ({ ...project, updatedOn: today(), dueOn: null }))
      const { html } = await page('/cantieri?filtro=da-aggiornare', EMAILS.board, { ...snapshot, projects })
      expect(html).toContain('Nessun cantiere da aggiornare.')
    })

    it('«Il mio gruppo» per chi non è rappresentante, o un filtro che non c’è, vale «Tutti»', async () => {
      for (const path of ['/cantieri?filtro=mio', '/cantieri?filtro=boh'])
        expect(titles((await page(path, EMAILS.board)).html)).toHaveLength(4)
    })

    it('ogni cantiere ha il suo id, per i risultati della ricerca', async () => {
      const { html } = await page('/cantieri', EMAILS.board)
      expect(html).toContain('<article class="card" id="CAN-0001">')
    })
  })

  it('chi ha un ruolo ma non è rappresentante non vede il tasto', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(html).not.toContain('Aggiorna il tuo gruppo')
  })

  it('senza istantanea lo dice a parole', async () => {
    const { res, html } = await page('/cantieri', undefined, null)
    expect(res.status).toBe(200)
    expect(html).toContain('I cantieri non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.')
  })
})

describe('/riservata', () => {
  it('dice dove sei e chi può vederla', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(html).toContain('Solo Direttivo, Coordinamento e segreteria')
    expect(html).toContain('<h1>Riservata</h1>')
  })

  it('un cantiere aggiornato 30 giorni fa è «Fermo da 30 giorni»; a 29 giorni non compare', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(card(html, 'Sito dei prodotti locali')).toContain('Fermo da 30 giorni')
    expect(html).not.toContain('Orto condiviso')
  })

  it('un cantiere con la scadenza passata da 10 giorni è «In ritardo di 10 giorni»', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(card(html, 'Scambio di semi autunnale')).toContain('In ritardo di 10 giorni')
  })

  it('in cima, quanti cantieri sono fermi o in ritardo', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(html).toMatch(/<b>2<\/b>\s*cantieri fermi o in ritardo/)
  })

  it('un cantiere che chiede aiuto compare, con la richiesta', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const help = html.slice(html.indexOf('Chiedono aiuto'))
    expect(help).toContain('Scambio di semi autunnale')
    expect(help).toContain('Ci serve qualcuno che porti i tavoli.')
  })

  it('senza cantieri fermi né richieste di aiuto, lo dice', async () => {
    const snapshot = reservedFixture()
    const projects = snapshot.projects
      .filter((project) => project.id === 'CAN-0001')
      .map((project) => ({ ...project, helpWanted: '' }))
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, projects })
    expect(html).toContain('Nessun cantiere fermo o in ritardo.')
    expect(html).toContain('Nessun cantiere chiede aiuto.')
  })

  it('in fondo, «Aggiornato il …» con la data dell’istantanea', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(html).toContain('Aggiornato il 18 ottobre 2026 alle 21:40.')
  })

  it('senza istantanea lo dice a parole', async () => {
    const { html } = await page('/riservata', EMAILS.board, null)
    expect(html).toContain('I dati della Riservata non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.')
  })

  it('l’istantanea che arriva da KV con dati rovinati non rompe la pagina', async () => {
    const res = await app.request('http://localhost:8788/riservata', {}, testEnv({ [RESERVED_KEY]: 'non è json' }))
    expect(res.status).toBe(200)
  })
})

describe('gli euro', () => {
  it('interi senza decimali, col punto delle migliaia anche sotto i 10.000', () => {
    expect(formatEuro(1200)).toBe('1.200\u00a0€')
    expect(formatEuro(27780)).toBe('27.780\u00a0€')
    expect(formatEuro(0)).toBe('0\u00a0€')
  })

  it('con i centesimi, sempre due cifre', () => {
    expect(formatEuro(4771.5)).toBe('4.771,50\u00a0€')
    expect(formatEuro(10271.499999)).toBe('10.271,50\u00a0€')
  })
})

describe('/riservata, i tre numeri in cima', () => {
  it('cantieri fermi o in ritardo, scadenze nei prossimi 30 giorni, scadenze senza nessuno', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const top = html.slice(html.indexOf('class="numeri"'), html.indexOf('<h2'))
    expect(top).toMatch(/<b>2<\/b>\s*cantieri fermi o in ritardo/)
    expect(top).toMatch(/<b>3<\/b>\s*scadenze nei prossimi 30 giorni/)
    expect(top).toMatch(/<b>1<\/b>\s*scadenza senza nessuno/)
  })

  it('al singolare con una scadenza, al plurale con due senza nessuno', async () => {
    const snapshot = reservedFixture()
    const deadlines = snapshot.deadlines
      .filter((item) => item.id === 'SCA-0003')
      .flatMap((item) => [item, { ...item, id: 'SCA-0010', dueOn: daysAgo(2), kind: 'duty' as const }])
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, deadlines })
    expect(html).toMatch(/<b>1<\/b>\s*scadenza nei prossimi 30 giorni/)
    expect(html).toMatch(/<b>2<\/b>\s*scadenze senza nessuno/)
  })
  it('sotto i numeri, in rosso e a parole, quanti adempimenti sono in ritardo', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const top = html.slice(html.indexOf('class="numeri"'), html.indexOf('<h2'))
    expect(top).toMatch(/class="stato bad"><span class="tri" aria-hidden="true"><\/span>1 adempimento in ritardo</)
  })

  it('con due adempimenti in ritardo è al plurale; senza, la riga non c’è', async () => {
    const snapshot = reservedFixture()
    const [late] = snapshot.deadlines
    const two = [...snapshot.deadlines, { ...late!, id: 'SCA-0011', kind: 'tax' as const, dueOn: daysAgo(2) }]
    expect((await page('/riservata', EMAILS.board, { ...snapshot, deadlines: two })).html).toContain(
      '2 adempimenti in ritardo',
    )
    const none = snapshot.deadlines.filter((item) => item.id !== late!.id)
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, deadlines: none })
    expect(html).not.toMatch(/adempiment[oi] in ritardo</)
  })
})

// Dalla prova in cinque del 26/10: Direttivo e segretario scorrevano troppo per arrivare a ciò che cercavano.
describe('/riservata, i salti in cima', () => {
  it('sotto i numeri, un link per sezione, nell’ordine e verso titoli che esistono', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const nav = html.match(/<nav [^>]*aria-label="Su questa pagina"[^>]*>(.*?)<\/nav>/)?.[1] ?? ''
    expect(nav).not.toBe('')
    expect(html.indexOf('class="numeri"')).toBeLessThan(html.indexOf('<nav class="salti"'))
    expect(html.indexOf('<nav class="salti"')).toBeLessThan(html.indexOf('<h2'))
    const jumps = [
      ['cantieri', 'Cantieri fermi', 'Cantieri fermi o in ritardo'],
      ['aiuto', 'Chiedono aiuto', 'Chiedono aiuto'],
      ['scadenze', 'Scadenze', 'Scadenze dei prossimi 30 giorni'],
      ['approvare', 'Da approvare', 'Da approvare'],
      ['impegni', 'Impegni', 'Impegni'],
      ['soci', 'Soci', 'Soci'],
      ['delibere', 'Delibere', 'Ultime delibere'],
      ['questioni', 'Questioni aperte', 'Questioni aperte'],
      ['budget', 'Budget', 'Budget per cantiere e impegno'],
    ]
    const links = [...nav.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])
    expect(links).toEqual(jumps.map(([id, label]) => [id, label]))
    for (const [id, , title] of jumps) expect(html).toContain(`<h2 id="${id}">${title}</h2>`)
  })

  it('il sottotitolo dice chi aggiorna cosa: i cantieri i rappresentanti dei GdL, gli impegni chi li propone e li prende', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(html).toContain(
      '<p class="sub">Il quadro dell’associazione. Cantieri e richieste d’aiuto li aggiornano i rappresentanti dei GdL, gli impegni chi li propone e chi li prende, il resto la segreteria e il tesoriere.</p>',
    )
  })
})

describe('/riservata, i cantieri aggiornati (O4)', () => {
  it('dati 15 cantieri aperti, 12 aggiornati da meno di 30 giorni: «12 su 15 (80%)»', async () => {
    const snapshot = reservedFixture()
    const base = snapshot.projects[0]!
    const projects = Array.from({ length: 15 }, (_, i) => ({
      ...base,
      id: `CAN-${100 + i}`,
      title: `Cantiere ${i}`,
      updatedOn: daysAgo(i < 12 ? 29 : 30),
    }))
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, projects })
    const projectsSection = section(html, 'Cantieri fermi o in ritardo')
    expect(projectsSection).toContain('Cantieri aggiornati da meno di 30 giorni: 12 su 15 (80%)')
    expect(projectsSection).toMatch(
      /class="stato ok"><span class="dot pieno" aria-hidden="true"><\/span>Obiettivo raggiunto/,
    )
  })

  it('sotto l’80% dice l’obiettivo, col cerchio vuoto e senza rosso', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    expect(section(html, 'Cantieri fermi o in ritardo')).toMatch(
      /class="stato warn"><span class="dot" aria-hidden="true"><\/span>Obiettivo: almeno l’80%/,
    )
  })

  it('sta subito sotto il titolo, prima dell’elenco', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const projects = section(html, 'Cantieri fermi o in ritardo')
    expect(projects).toContain('Cantieri aggiornati da meno di 30 giorni: 3 su 4 (75%)')
    expect(projects.indexOf('Cantieri aggiornati')).toBeLessThan(projects.indexOf('Scambio di semi autunnale'))
  })

  it('senza cantieri aperti lo dice', async () => {
    const { html } = await page('/riservata', EMAILS.board, { ...reservedFixture(), projects: [] })
    expect(section(html, 'Cantieri fermi o in ritardo')).toContain('Nessun cantiere aperto.')
    expect(html).not.toContain('Cantieri aggiornati da meno')
  })
})

describe('/riservata, le scadenze', () => {
  it('con un ritardo l’elenco si divide in «In ritardo» e «Nei prossimi 30 giorni», e la seconda parte torna col numero', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const list = section(html, 'Scadenze dei prossimi 30 giorni')
    const late = list.indexOf('>In ritardo</p>')
    const next = list.indexOf('>Nei prossimi 30 giorni</p>')
    expect(late).toBeGreaterThan(-1)
    expect(next).toBeGreaterThan(late)
    expect(list.slice(late, next)).toContain('Quota annuale all’ente di normazione')
    expect(list.slice(late, next)).toContain('Contare i messaggi senza risposta')
    expect(list.slice(next).match(/<article/g)).toHaveLength(3)
    expect(html).toMatch(/<b>3<\/b>\s*scadenze nei prossimi 30 giorni/)
  })

  it('senza nulla di passato, l’elenco è uno solo', async () => {
    const snapshot = reservedFixture()
    const deadlines = snapshot.deadlines.filter((item) => item.dueOn >= daysAgo(0))
    const list = section(
      (await page('/riservata', EMAILS.board, { ...snapshot, deadlines })).html,
      'Scadenze dei prossimi 30 giorni',
    )
    expect(list).not.toContain('>In ritardo</p>')
    expect(list).not.toContain('>Nei prossimi 30 giorni</p>')
  })

  const deadlines = async () =>
    section((await page('/riservata', EMAILS.board)).html, 'Scadenze dei prossimi 30 giorni')

  it('una scadenza fra 30 giorni c’è; fra 31, già fatta o un bando scaduto no', async () => {
    const list = await deadlines()
    expect(list).toContain('Bando regionale per la formazione')
    expect(list).toContain('Convocazione dell’Assemblea')
    expect(list).not.toContain('Save the date del Raduno')
    expect(list).not.toContain('Rinnovo dell’assicurazione')
    expect(list).not.toContain('Versamento delle ritenute')
    expect(list).not.toContain('Bando per i mercati contadini')
  })

  it('ogni scadenza dice il tipo e la data', async () => {
    const list = await deadlines()
    expect(card(list, 'Bando regionale per la formazione')).toContain(`Bando · ${formatDay(daysAgo(-30), today())}`)
    expect(card(list, 'Convocazione dell’Assemblea')).toContain(`Assemblea · ${formatDay(daysAgo(-12), today())}`)
  })

  it('mostra il ruolo di chi la segue', async () => {
    const list = await deadlines()
    expect(card(list, 'Convocazione dell’Assemblea')).toContain('Segue: il tesoriere')
    expect(card(list, 'Bando regionale per la formazione')).toContain('Segue: una persona di Struttura')
  })

  it('senza nessuno dice «Nessuno la segue», col triangolo rosso', async () => {
    const row = card(await deadlines(), 'Nomina per la piattaforma della newsletter')
    expect(row).toMatch(/class="stato bad"><span class="tri" aria-hidden="true"><\/span>Nessuno la segue/)
    expect(row).not.toContain('Segue:')
  })

  it('l’adempimento in ritardo sta in cima, in rosso e a parole', async () => {
    const list = await deadlines()
    const first = list.indexOf('<article')
    expect(list.indexOf('Quota annuale all’ente di normazione')).toBeGreaterThan(first)
    expect(list.indexOf('Quota annuale all’ente di normazione')).toBeLessThan(list.indexOf('<article', first + 1))
    const row = card(list, 'Quota annuale all’ente di normazione')
    expect(row).toMatch(/class="stato bad"><span class="tri" aria-hidden="true"><\/span>In ritardo di 5 giorni/)
    expect(row).toContain(`Adempimento · ${formatDay(daysAgo(5), today())}`)
  })

  it('una misura passata dice da quanti giorni, senza rosso', async () => {
    const row = card(await deadlines(), 'Contare i messaggi senza risposta')
    expect(row).toMatch(/class="stato warn"><span class="dot" aria-hidden="true"><\/span>Passata da 4 giorni/)
    expect(row).toContain('Misura · ')
    expect(row).not.toContain('bad')
  })

  it('in fondo, gli adempimenti fatti in ritardo nell’anno (O7)', async () => {
    expect(await deadlines()).toContain(`Adempimenti fatti in ritardo nel ${today().slice(0, 4)}: 1`)
  })

  it('a gennaio c’è anche l’anno appena chiuso, per copiare O7 fino al 31/1', async () => {
    const duty = (id: string, dueOn: string, doneOn: string) =>
      ({ id, what: id, kind: 'duty', dueOn, ownerRole: 'il tesoriere', doneOn }) as const
    const snapshot = {
      ...reservedFixture(),
      deadlines: [duty('SCA-a', '2027-12-20', '2028-01-05'), duty('SCA-b', '2028-01-03', '2028-01-04')],
    }
    const render = async (day: string) => (<RiservataPage snapshot={snapshot} today={day} />).toString()
    const january = await render('2028-01-31')
    expect(january).toContain('Adempimenti fatti in ritardo nel 2028: 1')
    expect(january).toContain('Adempimenti fatti in ritardo nel 2027: 1')
    expect(await render('2028-02-01')).not.toContain('nel 2027')
  })

  it('senza scadenze lo dice, e i numeri in cima sono zero', async () => {
    const { html } = await page('/riservata', EMAILS.board, { ...reservedFixture(), deadlines: [] })
    expect(section(html, 'Scadenze dei prossimi 30 giorni')).toContain('Nessuna scadenza nei prossimi 30 giorni.')
    expect(html).toMatch(/<b>0<\/b>\s*scadenze nei prossimi 30 giorni/)
    expect(html).toMatch(/<b>0<\/b>\s*scadenze senza nessuno/)
  })
})

describe('/riservata, le delibere', () => {
  const resolutions = async () => section((await page('/riservata', EMAILS.board)).html, 'Ultime delibere')

  it('quelle degli ultimi 12 mesi, dalla più recente', async () => {
    const list = await resolutions()
    const order = [
      'Calendario dei mercati di primavera',
      'Spesa per il webinar sui suoli',
      'Quote associative',
      'Bilancio preventivo',
      'Adesione alla campagna sui semi',
      'Regolamento dei gruppi di lavoro',
      'Apertura del conto per le donazioni',
    ].map((subject) => list.indexOf(`>${subject}<`))
    expect(order.every((position) => position > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(list).not.toContain('Deleghe bancarie')
  })

  it('con organo, data, ratifica e «Apri il verbale» che porta al Drive', async () => {
    const row = card(await resolutions(), 'Calendario dei mercati di primavera')
    expect(row).toContain(
      `Coordinamento · ${formatDay(daysAgo(10), today())} · ratificata il ${formatDay(daysAgo(4), today())}`,
    )
    expect(row).toContain('href="https://drive.google.com/file/d/verbale-10/view"')
    // Il nome del link comincia con la parola che si vede, e dice di quale delibera: i link non hanno lo stesso nome.
    expect(row).toContain('aria-label="Apri il verbale: Calendario dei mercati di primavera">Apri il verbale</a>')
  })

  it('senza link dice «Verbale non ancora nel Drive»', async () => {
    const row = card(await resolutions(), 'Spesa per il webinar sui suoli')
    expect(row).toMatch(/class="stato warn"><span class="dot" aria-hidden="true"><\/span>Verbale non ancora nel Drive/)
    expect(row).not.toContain('Apri il verbale')
    expect(row).not.toContain('ratificata')
  })

  it('se ne vedono cinque, le altre stanno dietro «Le altre 2 delibere degli ultimi 12 mesi»', async () => {
    const list = await resolutions()
    const details = list.indexOf('<details')
    expect(list).toContain('<summary>Le altre 2 delibere degli ultimi 12 mesi</summary>')
    expect(list.indexOf('Adesione alla campagna sui semi')).toBeLessThan(details)
    expect(list.indexOf('Regolamento dei gruppi di lavoro')).toBeGreaterThan(details)
  })

  it('una sola in più si dice al singolare', async () => {
    const snapshot = reservedFixture()
    const resolutions = snapshot.resolutions.filter((item) => item.subject !== 'Regolamento dei gruppi di lavoro')
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, resolutions })
    expect(html).toContain('<summary>L’altra delibera degli ultimi 12 mesi</summary>')
  })

  it('cinque o meno, niente da aprire', async () => {
    const snapshot = reservedFixture()
    const { html } = await page('/riservata', EMAILS.board, {
      ...snapshot,
      resolutions: snapshot.resolutions.slice(0, 5),
    })
    expect(html).not.toContain('<details')
  })

  it('senza delibere lo dice', async () => {
    const { html } = await page('/riservata', EMAILS.board, { ...reservedFixture(), resolutions: [] })
    expect(section(html, 'Ultime delibere')).toContain('Nessuna delibera negli ultimi 12 mesi.')
  })
})

describe('/riservata, le questioni aperte', () => {
  it('ognuna con da quando e chi la segue, o «Nessuno la segue»', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const list = section(html, 'Questioni aperte')
    expect(card(list, 'Diritti dei soci sostenitori')).toContain(`Aperta dal ${formatDay(daysAgo(50), today())}`)
    expect(card(list, 'Diritti dei soci sostenitori')).toContain('Segue: una persona del Direttivo')
    expect(card(list, 'Codice etico per sponsorizzazioni e donazioni')).toMatch(
      /class="stato bad"><span class="tri" aria-hidden="true"><\/span>Nessuno la segue/,
    )
    expect(card(list, 'Doppio tesseramento con altre associazioni')).not.toContain('Aperta dal')
  })

  it('senza questioni lo dice', async () => {
    const { html } = await page('/riservata', EMAILS.board, { ...reservedFixture(), issues: [] })
    expect(section(html, 'Questioni aperte')).toContain('Nessuna questione aperta.')
  })
})

describe('/riservata, il budget', () => {
  it('ogni riga ha previsto, speso e percentuale', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const budget = section(html, 'Budget per cantiere e impegno')
    expect(card(budget, 'Ciclo webinar e corsi')).toContain('Previsto 5.000 € · speso 1.200 € (24%)')
    expect(card(budget, 'Sito web')).toContain('Previsto 500 € · speso 500 € (100%)')
    expect(card(budget, 'Raduno di Cervia')).toContain('Previsto 4.771,50 € · speso 4.210 € (88%)')
  })

  it('il totale è la somma delle righe, e in fondo chi l’ha aggiornato e quando', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const budget = section(html, 'Budget per cantiere e impegno')
    expect(budget).toMatch(/Totale:<\/b> previsto 10\.271,50 € · speso 5\.910 € \(58%\)/)
    expect(budget).toContain(`Aggiornato dal tesoriere il ${formatDay(daysAgo(9), today())}.`)
  })

  it('un importo mancante è «—» e la percentuale non c’è; col previsto a zero neanche', async () => {
    const snapshot = reservedFixture()
    const budget = {
      updatedOn: null,
      lines: [
        { label: 'Mercati contadini', planned: 800, spent: null },
        { label: 'Scambio di semi', planned: null, spent: 120 },
        { label: 'Volantini', planned: 0, spent: 30 },
      ],
    }
    const { html } = await page('/riservata', EMAILS.board, { ...snapshot, budget })
    const text = section(html, 'Budget per cantiere e impegno')
    expect(card(text, 'Mercati contadini')).toContain('Previsto 800 € · speso —<')
    expect(card(text, 'Scambio di semi')).toContain('Previsto — · speso 120 €<')
    expect(card(text, 'Volantini')).toContain('Previsto 0 € · speso 30 €<')
    expect(text).toMatch(/Totale:<\/b> previsto 800 € · speso 150 € \(19%\)/)
    expect(text).not.toContain('Aggiornato dal tesoriere')
  })

  it('non ancora arrivato, lo dice e non mostra zeri', async () => {
    const { html } = await page('/riservata', EMAILS.board, {
      ...reservedFixture(),
      budget: { updatedOn: null, lines: [] },
    })
    const budget = section(html, 'Budget per cantiere e impegno')
    expect(budget).toContain('Il tesoriere non ha ancora inserito i numeri.')
    expect(budget).not.toContain('0 €')
    expect(budget).not.toContain('Totale')
  })
})

describe('/riservata, l’ordine e le istantanee di T1', () => {
  it('le sezioni vengono nell’ordine del cartamodello', async () => {
    const { html } = await page('/riservata', EMAILS.board)
    const order = [
      'Cantieri fermi o in ritardo',
      'Chiedono aiuto',
      'Scadenze dei prossimi 30 giorni',
      'Da approvare',
      'Impegni',
      'Ultime delibere',
      'Questioni aperte',
      'Budget per cantiere e impegno',
    ].map((title) => headingAt(html, title))
    expect(order.every((position) => position > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html.indexOf('Aggiornato il 18 ottobre 2026')).toBeGreaterThan(order.at(-1)!)
  })

  it('un’istantanea senza le sezioni di T2 non rompe la pagina', async () => {
    const { deadlines, resolutions, issues, budget, ...t1 } = reservedFixture()
    void [deadlines, resolutions, issues, budget]
    const { res, html } = await page('/riservata', EMAILS.board, t1 as ReservedSnapshot)
    expect(res.status).toBe(200)
    expect(html).toContain('Nessuna scadenza nei prossimi 30 giorni.')
    expect(html).toContain('Nessuna delibera negli ultimi 12 mesi.')
    expect(html).toContain('Nessuna questione aperta.')
    expect(html).toContain('Il tesoriere non ha ancora inserito i numeri.')
  })
})

// Access ferma chi non è nella sua lista, che chi cura la Bussola tiene a mano da «Persone della Riservata»: se le due
// liste si separano, la Function non apre i dati a chi non sta più nel Foglio.
describe('chi non sta in «Persone della Riservata»', () => {
  const REFUSAL = 'Questa parte della Bussola è per Direttivo, Coordinamento e segreteria.'

  for (const path of ['/cantieri', '/riservata']) {
    it(`su ${path} trova un rifiuto a parole, senza i dati`, async () => {
      const { res, html } = await page(path, EMAILS.outsider)
      expect(res.status).toBe(403)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(html).toContain(REFUSAL)
      for (const project of reservedFixture().projects) expect(html).not.toContain(project.title)
      expect(html).not.toContain('href="/riservata"')
    })
  }

  it('lo stesso se Access non dà la mail', async () => {
    const { res } = await page('/riservata')
    expect(res.status).toBe(403)
  })

  it('lo stesso se la sua riga non ha nessun ruolo', async () => {
    const snapshot = reservedFixture()
    const people = snapshot.people.map((person) => ({ ...person, roles: [] }))
    const { res } = await page('/cantieri', EMAILS.board, { ...snapshot, people })
    expect(res.status).toBe(403)
  })

  it('un rappresentante, che è del Coordinamento, entra anche nella Riservata', async () => {
    const { res } = await page('/riservata', EMAILS.rep)
    expect(res.status).toBe(200)
  })
})

describe('la barra', () => {
  it('ha «Riservata» per chi ha un ruolo, e la voce della pagina è segnata', async () => {
    const { html } = await page('/cantieri', EMAILS.board)
    expect(html).toContain('href="/riservata"')
    expect(html).toMatch(/<a[^>]*href="\/cantieri"[^>]*aria-current="page"/)
  })

  it('fra i giorni si conta oggi da Roma', () => {
    expect(daysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('/riservata, i numeri dei soci (T4)', () => {
  it('i conteggi per stato, il totale e la riga dei rinnovi, senza nomi né mail', async () => {
    const { html } = await requestPage('/riservata', EMAILS.board)
    const soci = section(html, 'Soci')
    expect(soci).toMatch(/<b>150<\/b>\s*in regola/)
    expect(soci).toMatch(/<b>110<\/b>\s*da rinnovare/)
    expect(soci).toMatch(/<b>7<\/b>\s*non in regola/)
    expect(soci).toMatch(new RegExp(`<b>3<\\/b>\\s*già in regola per il ${Number(daysAgo(0).slice(0, 4)) + 1}`))
    expect(visibleText(soci)).toContain('Soci non receduti: 270 · receduti: 12')
    expect(visibleText(soci)).toContain('Rinnovi 2027: 150 su 260 (58%) · bersaglio: oltre il 92% al 31/3')
    expect(visibleText(soci)).toContain('Obiettivo: oltre il 92% al 31/3')
    expect(soci).not.toContain('@')
  })

  it('oltre il bersaglio, «Obiettivo raggiunto»; senza la riga dei rinnovi, solo i numeri', async () => {
    const members = membersFixture()
    const reached = { ...members, renewals: { year: 2027, renewed: 242, base: 260, percent: 93, until: '03-31' } }
    const { html } = await requestPage('/riservata', EMAILS.board, { members: reached })
    expect(visibleText(section(html, 'Soci'))).toContain('Obiettivo raggiunto')
    const plain = await requestPage('/riservata', EMAILS.board, { members: { ...members, renewals: null } })
    expect(visibleText(section(plain.html, 'Soci'))).not.toContain('Rinnovi')
    expect(visibleText(section(plain.html, 'Soci'))).toContain('Soci non receduti: 270')
  })

  it('senza l’istantanea dei soci lo dice, e il resto della Riservata c’è', async () => {
    const { html } = await requestPage('/riservata', EMAILS.board, { members: null })
    expect(html).toContain('I numeri dei soci non sono ancora arrivati dalla segreteria.')
    expect(headingAt(html, 'Ultime delibere')).toBeGreaterThan(0)
  })

  it('un’istantanea dei soci con un campo in più, come dei nomi, si legge senza', async () => {
    const members = { ...membersFixture(), names: ['Anna Esempio'] }
    const { html } = await requestPage('/riservata', EMAILS.board, { members: members as never })
    expect(html).not.toContain('Anna Esempio')
    expect(visibleText(section(html, 'Soci'))).toContain('Soci non receduti: 270')
  })
})
