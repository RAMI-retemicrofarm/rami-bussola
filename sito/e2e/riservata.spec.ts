import { expect, test, type Page } from '@playwright/test'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'
import { expectDefinitionOfDone } from './fatto.ts'

test.use({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': DEMO_EMAILS.board } })

test('la Riservata mostra i cantieri fermi o in ritardo e chi chiede aiuto', async ({ page }) => {
  await page.goto('/riservata')
  await expect(page.getByText('Solo Direttivo, Coordinamento e segreteria')).toBeVisible()
  await expect(page.locator('.numeri')).toContainText('2 cantieri fermi o in ritardo')
  await expect(page.locator('article', { hasText: 'Scambio di semi autunnale' }).first()).toContainText(
    'In ritardo di 10 giorni',
  )
  await expect(page.locator('article', { hasText: 'Sito dei prodotti locali' })).toContainText('Fermo da 41 giorni')
  await expect(page.locator('article', { hasText: 'Ci serve qualcuno che porti i tavoli.' })).toBeVisible()
  await expect(page.getByText(/^Aggiornato il \d{1,2} \w+ \d{4} alle \d{2}:\d{2}\.$/)).toBeVisible()
})

/** La scheda che segue un titolo di sezione. */
const sectionCard = (page: Page, title: string) => page.locator(`h2:text-is("${title}") ~ .card`).first()

test('in cima i tre numeri, e sotto i cantieri la quota degli aggiornati (O4)', async ({ page }) => {
  await page.goto('/riservata')
  const numbers = page.locator('.numeri')
  await expect(numbers).toContainText('2 cantieri fermi o in ritardo')
  await expect(numbers).toContainText('4 scadenze nei prossimi 30 giorni')
  await expect(numbers).toContainText('1 scadenza senza nessuno')
  // Sotto i numeri, in rosso e a parole, l'adempimento in ritardo che il numero delle scadenze non conta.
  await expect(page.locator('.numeri + .stato.bad')).toHaveText('1 adempimento in ritardo')
  await expect(page.getByText('Cantieri aggiornati da meno di 30 giorni: 3 su 4 (75%)')).toBeVisible()
})

test('le scadenze dei prossimi 30 giorni, con l’adempimento in ritardo in cima e chi le segue', async ({ page }) => {
  await page.goto('/riservata')
  const deadlines = sectionCard(page, 'Scadenze dei prossimi 30 giorni')
  const first = deadlines.locator('article').first()
  await expect(first).toContainText(/Quota annuale all.ente di normazione/)
  await expect(first.locator('.stato.bad')).toHaveText('In ritardo di 5 giorni')
  await expect(first).toContainText('Segue: il tesoriere')
  await expect(deadlines.locator('article')).toHaveCount(5)
  // Le due parti: la seconda ha tante righe quante ne conta il numero in cima.
  await expect(deadlines.locator('.gruppo')).toHaveText(['In ritardo', 'Nei prossimi 30 giorni'])
  await expect(deadlines.locator('.gruppo').last().locator('~ article')).toHaveCount(4)
  for (const what of [
    /Convocazione dell.Assemblea/,
    'Bando regionale per la formazione',
    'Contare i messaggi senza risposta da più di 5 giorni',
  ])
    await expect(deadlines).toContainText(what)
  await expect(deadlines).not.toContainText('Save the date del Raduno')
  await expect(deadlines).not.toContainText('Bando per i mercati contadini')
  await expect(
    deadlines.locator('article', { hasText: 'Nomina per la piattaforma della newsletter' }).locator('.stato.bad'),
  ).toHaveText('Nessuno la segue')
  // O7: la scadenza fiscale fatta in ritardo 40 giorni fa conta se cade nell'anno di oggi.
  const sameYear = new Date(Date.now() - 40 * 86_400_000).getFullYear() === new Date().getFullYear()
  // A gennaio c'è anche la riga dell'anno chiuso: si guarda quella dell'anno di oggi.
  const year = new Date().getFullYear()
  await expect(page.getByText(new RegExp(`^Adempimenti fatti in ritardo nel ${year}: \\d+$`))).toHaveText(
    new RegExp(`: ${sameYear ? 1 : 0}$`),
  )
})

test('le delibere degli ultimi 12 mesi, dalla più recente, col verbale', async ({ page }) => {
  await page.goto('/riservata')
  const resolutions = sectionCard(page, 'Ultime delibere')
  const first = resolutions.locator('article').first()
  await expect(first.getByRole('heading')).toHaveText('Calendario dei mercati di primavera')
  await expect(first).toContainText(/Coordinamento · \d{1,2} \w+.* · ratificata il \d{1,2} \w+/)
  await expect(
    first.getByRole('link', { name: 'Apri il verbale: Calendario dei mercati di primavera' }),
  ).toHaveAttribute('href', /^https:\/\/(drive|docs)\.google\.com\//)
  await expect(resolutions.locator('article', { hasText: 'Spesa per il webinar sui suoli' })).toContainText(
    'Verbale non ancora nel Drive',
  )
  await expect(resolutions).not.toContainText('Deleghe bancarie')
  const more = resolutions.locator('summary')
  await expect(more).toHaveText('Le altre 2 delibere degli ultimi 12 mesi')
  await expect(resolutions.locator('article:visible')).toHaveCount(5)
  await more.click()
  await expect(resolutions.locator('article:visible')).toHaveCount(7)
})

test('le questioni aperte, con chi le segue', async ({ page }) => {
  await page.goto('/riservata')
  const issues = sectionCard(page, 'Questioni aperte')
  await expect(issues.locator('article')).toHaveCount(3)
  await expect(issues).toContainText('Diritti dei soci sostenitori')
  await expect(issues).toContainText('Doppio tesseramento con altre associazioni')
  await expect(issues).not.toContainText('Service audio e video del Raduno')
  await expect(
    issues.locator('article', { hasText: 'Codice etico per sponsorizzazioni e donazioni' }).locator('.stato.bad'),
  ).toHaveText('Nessuno la segue')
})

test('il budget per cantiere: previsto, speso, percentuale, il totale e chi l’ha aggiornato', async ({ page }) => {
  await page.goto('/riservata')
  const budget = sectionCard(page, 'Budget per cantiere')
  await expect(budget.locator('article', { hasText: 'Ciclo webinar e corsi' })).toContainText(
    'Previsto 5.000 € · speso 1.200 € (24%)',
  )
  await expect(budget.locator('article', { hasText: 'Sito web' })).toContainText('Previsto 500 € · speso 500 € (100%)')
  await expect(budget.locator('article', { hasText: 'Raduno di Cervia' })).toContainText(
    'Previsto 4.771,50 € · speso 4.210 € (88%)',
  )
  await expect(budget).toContainText('Totale: previsto 10.271,50 € · speso 5.910 € (58%)')
  await expect(budget).toContainText(/Aggiornato dal tesoriere il \d{1,2} \w+/)
})

test('dalla barra si passa ai Cantieri e si torna', async ({ page }) => {
  await page.goto('/riservata')
  await page.getByRole('link', { name: 'Cantieri' }).click()
  await expect(page).toHaveURL(/\/cantieri$/)
  await page.getByRole('link', { name: 'Riservata' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riservata')
})

test('/riservata rispetta la definizione di fatto', async ({ page }) => {
  await page.goto('/riservata')
  await expectDefinitionOfDone(page)
})

test('/riservata rispetta la definizione di fatto anche con le delibere più vecchie aperte', async ({ page }) => {
  await page.goto('/riservata')
  // Si apre senza toccarlo: col tocco il focus resterebbe sul summary, e i Tab non partirebbero dall'inizio.
  await page.locator('details').evaluate((details) => details.setAttribute('open', ''))
  await expectDefinitionOfDone(page)
})
