import { RESERVED_KEY, type ReservedSnapshot } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import app from './index.tsx'
import {
  commitment,
  COMMITMENT_FORM_URL,
  commitmentsFixture,
  daysAgo,
  EMAILS,
  reservedFixture,
  testEnv,
  visibleText,
} from './testing.ts'
import { formatDay } from './ui.tsx'

async function page(path: string, snapshot: ReservedSnapshot = reservedFixture(), email: string = EMAILS.board) {
  const res = await app.request(
    `http://localhost:8788${path}`,
    { headers: { 'X-Bussola-Prova-Mail': email } },
    testEnv({ [RESERVED_KEY]: snapshot }),
  )
  return { res, html: await res.text() }
}

/** Una sezione, dal suo titolo al titolo dopo, come testo. */
const section = (html: string, title: string) => {
  const at = html.indexOf(`>${title}</h2>`)
  const start = at < 0 ? -1 : html.lastIndexOf('<h2', at)
  if (start < 0) return ''
  const end = html.indexOf('<h2', start + 1)
  return visibleText(html.slice(start, end < 0 ? undefined : end))
}

const today = () => daysAgo(0)

/** I sette impegni, più uno che il Coordinamento ha approvato e aspetta il Direttivo. */
const withApproved = (): ReservedSnapshot => ({
  ...reservedFixture(),
  commitments: [
    ...commitmentsFixture(),
    commitment({
      id: 'IMP-0008',
      title: 'Corso di potatura',
      status: 'approved',
      forLabel: 'Formazione',
      groupId: null,
      proposedOn: daysAgo(20),
      coordinationOn: daysAgo(5),
    }),
  ],
})

describe('la Riservata: gli impegni', () => {
  it('dati sette impegni dell’anno, scrive «Impegni coperti: 2 su 5 (40%)»', async () => {
    const { html } = await page('/riservata')
    expect(section(html, 'Impegni')).toContain('Impegni coperti: 2 su 5 (40%)')
    expect(section(html, 'Impegni')).toContain('Obiettivo: almeno l’80%')
  })

  it('«Da approvare» divide chi aspetta il Coordinamento da chi aspetta il Direttivo, con le date', async () => {
    const { html } = await page('/riservata', withApproved())
    const text = section(html, 'Da approvare')
    const coordination = text.indexOf('Aspettano il Coordinamento')
    const board = text.indexOf('Aspettano il Direttivo')
    expect(coordination).toBeGreaterThanOrEqual(0)
    expect(board).toBeGreaterThan(coordination)
    const waitingCoordination = text.slice(coordination, board)
    expect(waitingCoordination).toContain('Tesseramento online')
    expect(waitingCoordination).toContain(`Proposto il ${formatDay(daysAgo(6), today())}`)
    expect(waitingCoordination).not.toContain('Corso di potatura')
    const waitingBoard = text.slice(board)
    expect(waitingBoard).toContain('Corso di potatura')
    expect(waitingBoard).toContain(`Approvato dal Coordinamento il ${formatDay(daysAgo(5), today())}`)
    expect(waitingBoard).not.toContain('Tesseramento online')
  })

  it('il respinto, con il motivo', async () => {
    const { html } = await page('/riservata')
    const text = section(html, 'Da approvare')
    expect(text).toContain('Respinti')
    expect(text).toContain('Stand alla fiera regionale')
    expect(text).toContain('Motivo: Il Coordinamento preferisce aspettare il bando di primavera.')
  })

  it('senza schede in attesa lo dice', async () => {
    const snapshot = { ...reservedFixture(), commitments: [] }
    const { html } = await page('/riservata', snapshot)
    expect(section(html, 'Da approvare')).toContain('Nessuna scheda aspetta il Coordinamento o il Direttivo.')
    expect(section(html, 'Impegni')).toContain('Nessun impegno quest’anno.')
  })

  it('un impegno retribuito, con dello speso e senza ratifica: «Compenso senza scheda approvata»', async () => {
    const { html } = await page('/riservata')
    const text = section(html, 'Impegni')
    expect(text).toContain('Compenso senza scheda approvata')
    expect(html.match(/Compenso senza scheda approvata/g)).toHaveLength(1)
    // Ratificato, o senza speso, non lo è.
    const fine = reservedFixture()
    fine.commitments = fine.commitments.map((item) =>
      item.id === 'IMP-0002'
        ? { ...item, spent: null }
        : item.id === 'IMP-0005'
          ? { ...item, pay: 'paid', spent: 300 }
          : item,
    )
    expect((await page('/riservata', fine)).html).not.toContain('Compenso senza scheda approvata')
  })

  it('un impegno preso si mostra «Preso», col GdL o il ruolo, mai il nome né il numero', async () => {
    const { html } = await page('/riservata')
    const text = section(html, 'Impegni')
    expect(text).toContain('Preso · una persona di Semi e Biodiversità')
    expect(text).not.toContain('34')
    const byGroup = reservedFixture()
    byGroup.commitments = byGroup.commitments.map((item) =>
      item.id === 'IMP-0005' ? { ...item, assigneeRole: '' } : item,
    )
    expect(section((await page('/riservata', byGroup)).html, 'Impegni')).toContain('Preso · GdL Semi e Biodiversità')
  })

  it('il tasto «Proponi un impegno» porta al Modulo, e ogni impegno alla sua scheda', async () => {
    const { html } = await page('/riservata')
    expect(html).toContain(`href="${COMMITMENT_FORM_URL}"`)
    expect(html).toContain('href="/riservata/impegni/IMP-0002"')
    expect(html).toContain('aria-label="Apri la scheda: Tesseramento online"')
  })

  it('il budget è per cantiere e impegno: la voce di un impegno ha previsto e speso', async () => {
    const snapshot = reservedFixture()
    snapshot.budget.lines = [
      ...snapshot.budget.lines,
      { label: 'Tesseramento online (IMP-0002)', planned: 800, spent: 200 },
    ]
    const text = section((await page('/riservata', snapshot)).html, 'Budget per cantiere e impegno')
    expect(text).toContain('Tesseramento online (IMP-0002)')
    expect(text).toContain('Previsto 800 € · speso 200 € (25%)')
  })

  it('gli impegni degli anni prima ancora aperti stanno sotto, a parte', async () => {
    const snapshot = reservedFixture()
    const lastYear = Number(today().slice(0, 4)) - 1
    snapshot.commitments = [
      ...snapshot.commitments,
      commitment({
        id: 'IMP-0009',
        title: 'Archivio dei verbali',
        status: 'taken',
        year: lastYear,
        assigneeRole: 'una persona della segreteria',
      }),
    ]
    const text = section((await page('/riservata', snapshot)).html, 'Impegni')
    const before = text.indexOf('Degli anni prima, ancora aperti')
    expect(before).toBeGreaterThan(text.indexOf('Banco dei semi agli scambi'))
    expect(text.slice(before)).toContain('Archivio dei verbali')
    expect(text.slice(before)).toContain('Preso · una persona della segreteria')
  })

  it('con solo impegni respinti o ritirati non dice «Nessun impegno quest’anno»', async () => {
    const snapshot = {
      ...reservedFixture(),
      commitments: commitmentsFixture().filter((item) => item.status === 'rejected' || item.outcome === 'withdrawn'),
    }
    const text = section((await page('/riservata', snapshot)).html, 'Impegni')
    expect(text).not.toContain('Nessun impegno quest’anno.')
    expect(text).toContain('Nessun impegno da coprire quest’anno.')
    expect(text).toContain('Stand alla fiera regionale')
  })

  it('dello speso senza ratifica si segnala anche senza retribuzione scritta, o su una riga da scrivere', async () => {
    const snapshot = reservedFixture()
    snapshot.commitments = snapshot.commitments.map((item) =>
      item.id === 'IMP-0001' ? { ...item, spent: 300 } : item.id === 'IMP-0002' ? { ...item, pay: null } : item,
    )
    expect((await page('/riservata', snapshot)).html.match(/Compenso senza scheda approvata/g)).toHaveLength(2)
  })

  it('un impegno preso senza ruolo né GdL riconosciuto dice per chi è, come è scritto', async () => {
    const snapshot = reservedFixture()
    snapshot.commitments = snapshot.commitments.map((item) =>
      item.id === 'IMP-0005' ? { ...item, assigneeRole: '', groupId: null, forLabel: 'Coordinamento' } : item,
    )
    expect(section((await page('/riservata', snapshot)).html, 'Impegni')).toContain('Preso · Coordinamento')
  })
})

describe('/riservata/impegni/:id, la scheda in sette blocchi', () => {
  it('ha i sette blocchi, nell’ordine', async () => {
    const { res, html } = await page('/riservata/impegni/IMP-0002')
    expect(res.status).toBe(200)
    expect(html).toContain('<h1>Tesseramento online</h1>')
    const blocks = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1])
    expect(blocks).toEqual([
      '1. Cosa si fa',
      '2. Per quale cantiere o GdL',
      '3. Quanto tempo',
      '4. Cosa si consegna e chi verifica',
      '5. Come si è pagati',
      '6. Chi l’ha approvato',
      '7. Se serve smettere',
    ])
  })

  it('scrive la scheda com’è, coi numeri soci e mai un nome', async () => {
    const { html } = await page('/riservata/impegni/IMP-0002')
    const text = visibleText(html)
    expect(text).toContain('Proposto')
    expect(section(html, '1. Cosa si fa')).toContain('Preparare il modulo di iscrizione online')
    expect(section(html, '3. Quanto tempo')).toContain('Giornate 8')
    expect(section(html, '3. Quanto tempo')).toContain('Tipo A progetto')
    expect(section(html, '4. Cosa si consegna e chi verifica')).toContain('Chi verifica socio n. 12 · Direttivo')
    expect(section(html, '5. Come si è pagati')).toContain('Retribuzione Compenso')
    expect(section(html, '5. Come si è pagati')).toContain('Compenso 800 €')
    expect(section(html, '5. Come si è pagati')).toContain('Si vede ai soci No: vedono il tipo e le giornate')
    expect(section(html, '6. Chi l’ha approvato')).toContain(
      `Proposto da socio n. 34 · rappresentante il ${formatDay(daysAgo(6), today())}`,
    )
    expect(section(html, '6. Chi l’ha approvato')).toContain('Delibera del Coordinamento non ancora')
    expect(section(html, '6. Chi l’ha approvato')).toContain('Ratifica del Direttivo non ancora')
    expect(section(html, '7. Se serve smettere')).toContain('Come si lascia Con due settimane di preavviso.')
  })

  it('ha previsto e speso, come i cantieri, e l’avviso del compenso senza scheda approvata', async () => {
    const { html } = await page('/riservata/impegni/IMP-0002')
    expect(section(html, '5. Come si è pagati')).toContain('Previsto 800 € · speso 200 € (25%)')
    expect(visibleText(html)).toContain('Compenso senza scheda approvata')
  })

  it('gli a capo scritti nel Modulo restano, senza HTML', async () => {
    const snapshot = reservedFixture()
    snapshot.commitments = snapshot.commitments.map((item) =>
      item.id === 'IMP-0002'
        ? { ...item, what: 'Primo: il modulo.\nSecondo: <b>la prova</b>.', deliverables: '1) il modulo\n2) la guida' }
        : item,
    )
    const { html } = await page('/riservata/impegni/IMP-0002', snapshot)
    expect(html).toContain('<p class="testo-libero">Primo: il modulo.\nSecondo: &lt;b&gt;la prova&lt;/b&gt;.</p>')
    expect(html).toContain('<dd class="testo-libero">1) il modulo\n2) la guida</dd>')
    expect(html.match(/class="testo-libero"/g)).toHaveLength(4)
  })

  it('un importo non scritto si legge «non ancora scritto», non un trattino', async () => {
    const snapshot = reservedFixture()
    snapshot.commitments = snapshot.commitments.map((item) =>
      item.id === 'IMP-0002' ? { ...item, fee: null, planned: null, spent: null } : item,
    )
    const text = section((await page('/riservata/impegni/IMP-0002', snapshot)).html, '5. Come si è pagati')
    expect(text).toContain('Compenso non ancora scritto')
    expect(text).toContain('Budget Previsto non ancora scritto · speso non ancora scritto')
    expect(text).not.toContain('—')
    const half = reservedFixture()
    half.commitments = half.commitments.map((item) => (item.id === 'IMP-0002' ? { ...item, spent: null } : item))
    expect(section((await page('/riservata/impegni/IMP-0002', half)).html, '5. Come si è pagati')).toContain(
      'Budget Previsto 800 € · speso non ancora scritto',
    )
  })

  it('una scheda respinta dice il motivo', async () => {
    const { html } = await page('/riservata/impegni/IMP-0003')
    expect(visibleText(html)).toContain(
      'Respinto. Motivo: Il Coordinamento preferisce aspettare il bando di primavera.',
    )
  })

  it('un impegno che non c’è: 404, a parole', async () => {
    const { res, html } = await page('/riservata/impegni/IMP-0099')
    expect(res.status).toBe(404)
    expect(html).toContain('Impegno non trovato')
  })

  it('chi non è nelle Persone della Riservata non la vede', async () => {
    const { res, html } = await page('/riservata/impegni/IMP-0002', reservedFixture(), EMAILS.outsider)
    expect(res.status).toBe(403)
    expect(html).not.toContain('Tesseramento online')
  })
})
