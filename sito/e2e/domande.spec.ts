import { expect, test, type Page } from '@playwright/test'
import { DEMO_CODES, DEMO_EMAILS, DEMO_MEET, DEMO_REFERENTS } from '../../motore/src/demo.ts'
import { expectDefinitionOfDone } from './fatto.ts'

// T7 «Le quattro domande»: Home, Cantieri coi filtri, Gruppi, pagina del gruppo, Link, Primo giorno e ricerca, coi dati
// che il giro del motore ha scritto nel KV locale dal Foglio inventato (npm run seed:local -w motore).
const as = (email: string) => ({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': email } })

/** Un tocco: un link o un tasto col suo nome, poi si aspetta la pagina. */
const tap = (page: Page, name: string | RegExp) => page.getByRole('main').getByRole('link', { name }).first().click()

/** I link dentro `main` di una pagina, letti dall'HTML come indirizzi del sito: quelli che una persona può toccare. */
async function linksIn(page: Page, path: string): Promise<string[]> {
  const html = await (await page.request.get(path)).text()
  const main = /<main[\s>][\s\S]*?<\/main>/.exec(html)?.[0] ?? ''
  return [...main.matchAll(/<a\s[^>]*href="([^"]+)"/g)]
    .map((match) => new URL((match[1] ?? '').replace(/&amp;/g, '&'), `http://localhost${path}`))
    .filter((url) => url.hostname === 'localhost')
    .map((url) => `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Quanti link servono dalla Home per arrivare a `target`, seguendo i link che stanno nell'HTML delle pagine, fino a
 * `max` passi: la misura dei tocchi, non il conto dei clic della prova. Infinity se non ci si arriva.
 */
async function linksFromHome(page: Page, target: string, max = 2): Promise<number> {
  let frontier = ['/']
  const seen = new Set(frontier)
  for (let steps = 1; steps <= max; steps++) {
    const next: string[] = []
    for (const path of frontier)
      for (const href of await linksIn(page, path)) {
        if (href === target) return steps
        const linked = href.replace(/#.*$/, '')
        if (!seen.has(linked)) {
          seen.add(linked)
          next.push(linked)
        }
      }
    frontier = next
  }
  return Infinity
}

test.describe('dalla Home, ognuna delle quattro risposte sta al più a 2 tocchi', () => {
  test.use(as(DEMO_EMAILS.board))

  test('«Cosa si sta facendo?»: i cantieri, a 1 tocco', async ({ page }) => {
    expect(await linksFromHome(page, '/cantieri')).toBeLessThanOrEqual(2)
    await page.goto('/')
    await tap(page, /Cosa si sta facendo\?/)
    await expect(page).toHaveURL(/\/cantieri$/)
    await expect(page.locator('article', { hasText: 'Rete dei mercati contadini' })).toContainText('In corso')
  })

  test('«Chi fa cosa, e come lo contatto?»: referenti e contatto del gruppo, a 2 tocchi', async ({ page }) => {
    expect(await linksFromHome(page, '/gruppi/GDL-orti')).toBeLessThanOrEqual(2)
    await page.goto('/')
    await tap(page, /Chi fa cosa, e come lo contatto\?/)
    await tap(page, 'Orti e Suoli')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orti e Suoli')
    await expect(page.getByText('Lia Prova, referente')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Entra nella chat del gruppo' })).toHaveAttribute(
      'href',
      'https://chat.example.org/orti-e-suoli',
    )
  })

  test('«Quando ci si vede?»: il prossimo incontro con «Entra su Meet», già sulla Home', async ({ page }) => {
    expect(await linksFromHome(page, '/#incontro')).toBeLessThanOrEqual(2)
    await page.goto('/')
    const meet = page.locator('#incontro').getByRole('link', { name: /Entra su Meet/ })
    await expect(meet).toHaveAttribute('href', DEMO_MEET.orti)
    await tap(page, /Quando ci si vede\?/)
    await expect(page).toHaveURL(/#incontro$/)
    await expect(meet).toBeInViewport()
  })

  test('«Dove trovo chat e documenti?»: i link con chi li può aprire, a 1 tocco', async ({ page }) => {
    expect(await linksFromHome(page, '/link')).toBeLessThanOrEqual(2)
    await page.goto('/')
    await tap(page, /Dove trovo chat e documenti\?/)
    await expect(page).toHaveURL(/\/link$/)
    const row = page.locator('article', { hasText: 'Verbali del Coordinamento' })
    await expect(row).toContainText('Lo apre solo il Coordinamento.')
    await expect(row).toContainText('Per entrare, chiedi alla segreteria.')
  })

  test('una pagina che la Home non collega non si trova in 2 tocchi: la misura sa fallire', async ({ page }) => {
    expect(await linksFromHome(page, '/riservata/impegni/IMP-0003')).toBe(Infinity)
  })

  test('«Il primo giorno» a un tocco', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /Il primo giorno/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Il primo giorno')
    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Scegli un gruppo')
  })
})

test.describe('la Home', () => {
  test('per il Direttivo: l’incontro aperto ai soci, i tre cantieri più freschi, le scadenze dei soci a 90 giorni', async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({ 'X-Bussola-Prova-Mail': DEMO_EMAILS.board })
    await page.goto('/')
    await expect(page.locator('#incontro')).toContainText('GdL Orti e Suoli')
    await expect(page.getByText(DEMO_MEET.coordination)).toHaveCount(0)
    const recent = page.locator('h2:text-is("Cosa succede") + .card h3')
    await expect(recent).toHaveText(['Rete dei mercati contadini', 'Corso sui suoli vivi', 'Scambio di semi autunnale'])
    const deadlines = page.locator('h2:text-is("Prossime scadenze") + .card')
    await expect(deadlines).toContainText('Raduno di primavera')
    await expect(deadlines).not.toContainText('Assemblea dei soci di primavera')
    await expect(deadlines).not.toContainText('Quota annuale')
  })

  test('per il rappresentante: il suo gruppo, il prossimo incontro anche solo per il gruppo, e i suoi tasti', async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({ 'X-Bussola-Prova-Mail': DEMO_EMAILS.rep })
    await page.goto('/')
    const mine = page.locator('#incontro')
    await expect(mine.getByRole('heading')).toHaveText('Il mio gruppo: GdL Orti e Suoli')
    await expect(mine.getByRole('link', { name: /Entra su Meet/ })).toHaveAttribute('href', DEMO_MEET.ortiInternal)
    const add = mine.getByRole('link', { name: 'Aggiungi un incontro' })
    const url = new URL((await add.getAttribute('href')) ?? '')
    expect(url.origin).toBe('https://docs.google.com')
    expect(url.searchParams.get('entry.2001')).toBe('Orti e Suoli')
    expect(url.searchParams.get('entry.2002')).toBe(DEMO_CODES['GDL-orti'])
    await mine.getByRole('link', { name: 'Aggiorna il tuo gruppo' }).click()
    await expect(page).toHaveURL(/\/cantieri\?filtro=mio$/)
    await expect(page.locator('nav.filtri [aria-current="page"]')).toHaveText(/Il mio gruppo/)
    await expect(page.locator('article.card')).toHaveCount(1)
  })
})

test.describe('le altre pagine', () => {
  test.use(as(DEMO_EMAILS.board))

  test('/cantieri: «Da aggiornare» mostra i cantieri fermi o in ritardo', async ({ page }) => {
    await page.goto('/cantieri')
    await page.getByRole('link', { name: /Da aggiornare/ }).click()
    await expect(page.locator('article.card h2')).toHaveText(['Sito dei prodotti locali', 'Scambio di semi autunnale'])
  })

  test('la pagina del gruppo: il referente senza consenso solo col ruolo; il contatto è la segreteria se la chat è chiusa', async ({
    page,
  }) => {
    await page.goto('/gruppi/GDL-orti')
    await expect(page.locator('ul.referenti li')).toHaveText(['Lia Prova, referente', 'Co-referente'])
    for (const name of DEMO_REFERENTS.withoutConsent) await expect(page.getByText(name)).toHaveCount(0)
    await page.goto('/gruppi/GDL-semi')
    await expect(page.getByText('La chat del gruppo è solo per chi partecipa.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Scrivi alla segreteria' })).toBeVisible()
  })

  test('la ricerca trova un gruppo, un cantiere e un link; senza risultati lo dice', async ({ page }) => {
    await page.goto('/')
    const search = async (word: string) => {
      await page.getByLabel('Cerca fra gruppi, cantieri e link').fill(word)
      await page.getByRole('button', { name: 'Cerca' }).click()
    }
    await search('Biodiversità')
    await expect(page.getByRole('link', { name: 'Semi e Biodiversità' })).toHaveAttribute('href', '/gruppi/GDL-semi')
    await search('mercati')
    await expect(page.getByRole('link', { name: 'Rete dei mercati contadini' })).toHaveAttribute(
      'href',
      '/cantieri#CAN-0001',
    )
    await search('semenzai')
    // Il Direttivo non è del GdL Orti e Suoli: il link si trova, col titolo e chi lo apre, ma senza l'indirizzo.
    await expect(page.getByText('Cartella dei semenzai')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Cartella dei semenzai' })).toHaveCount(0)
    await expect(page.getByText('Lo aprono solo i partecipanti del GdL Orti e Suoli.')).toBeVisible()
    await search('zucchine')
    await expect(page.getByRole('status')).toHaveText(
      "Nessun risultato per «zucchine». Prova con un'altra parola, o guarda i Gruppi.",
    )
  })
})

test.describe('con JavaScript spento', () => {
  test.use({ ...as(DEMO_EMAILS.rep), javaScriptEnabled: false })

  const PAGES: [string, string, string | RegExp][] = [
    ['/', 'Bussola', 'Il mio gruppo: GdL Orti e Suoli'],
    ['/cantieri', 'Cantieri', 'Rete dei mercati contadini'],
    ['/cantieri?filtro=da-aggiornare', 'Cantieri', 'Sito dei prodotti locali'],
    ['/gruppi', 'Gruppi', 'Semi e Biodiversità'],
    ['/gruppi/GDL-orti', 'Orti e Suoli', 'Lia Prova, referente'],
    ['/link', 'Link', 'Calendario degli incontri'],
    ['/primo-giorno', 'Il primo giorno', 'Scegli un gruppo'],
    ['/cerca?q=semi', 'Cerca', 'Semi e Biodiversità'],
    ['/riservata', 'Riservata', 'Cantieri fermi o in ritardo'],
  ]

  for (const [path, title, text] of PAGES)
    test(`${path} funziona, senza script`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
      await expect(page.getByText(text).first()).toBeVisible()
      await expect(page.locator('script')).toHaveCount(0)
    })

  test('la ricerca e i filtri vanno coi soli link e moduli', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Cerca fra gruppi, cantieri e link').fill('mercati')
    await page.getByRole('button', { name: 'Cerca' }).click()
    await expect(page).toHaveURL(/\/cerca\?q=mercati$/)
    await page.getByRole('link', { name: 'Rete dei mercati contadini' }).click()
    await expect(page).toHaveURL(/\/cantieri#CAN-0001$/)
    await page.getByRole('link', { name: /Il mio gruppo/ }).click()
    await expect(page.locator('nav.filtri [aria-current="page"]')).toHaveText(/Il mio gruppo/)
  })
})

test.describe('la definizione di fatto sulle pagine nuove', () => {
  const PAGES: [string, string][] = [
    ['/', DEMO_EMAILS.board],
    ['/', DEMO_EMAILS.rep],
    ['/cantieri?filtro=mio', DEMO_EMAILS.rep],
    ['/gruppi', DEMO_EMAILS.board],
    ['/gruppi/GDL-orti', DEMO_EMAILS.rep],
    ['/gruppi/GDL-semi', DEMO_EMAILS.board],
    ['/link', DEMO_EMAILS.board],
    ['/primo-giorno', DEMO_EMAILS.board],
    ['/cerca?q=semi', DEMO_EMAILS.board],
    ['/cerca?q=zucchine', DEMO_EMAILS.board],
  ]
  for (const [path, email] of PAGES)
    test(`${path}, come ${email.split('@')[0]}`, async ({ page }) => {
      await page.context().setExtraHTTPHeaders({ 'X-Bussola-Prova-Mail': email })
      await page.goto(path)
      await expectDefinitionOfDone(page)
    })
})
