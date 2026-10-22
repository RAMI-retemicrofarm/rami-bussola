import { expect, test } from '@playwright/test'
import { DEMO_CODES, DEMO_EMAILS } from '../../motore/src/demo.ts'
import { expectDefinitionOfDone } from './fatto.ts'

// I dati li ha scritti nel KV locale il giro del motore, sul Foglio con dati inventati (npm run seed:local -w motore).
// In locale chi entra lo dice la mail di prova, che su pages.dev non conta.
const as = (email: string) => ({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': email } })
const updateLink = /Aggiorna il tuo gruppo/

test.describe('il rappresentante di Orti e Suoli', () => {
  test.use(as(DEMO_EMAILS.rep))

  test('tocca «Aggiorna il tuo gruppo» e va al Modulo con gruppo, cantiere e codice del gruppo già scritti', async ({
    page,
  }) => {
    await page.goto('/cantieri')
    await expect(page.getByRole('heading', { name: 'Sei referente di: GdL Orti e Suoli' })).toBeVisible()
    const button = page.locator('article', { hasText: 'Rete dei mercati contadini' }).getByRole('link', {
      name: updateLink,
    })
    await expect(button).toBeVisible()
    const url = new URL((await button.getAttribute('href')) ?? '')
    expect(url.origin).toBe('https://docs.google.com')
    expect(url.searchParams.get('entry.1001')).toBe('Orti e Suoli')
    expect(url.searchParams.get('entry.1002')).toBe('Rete dei mercati contadini (CAN-0001)')
    expect(url.searchParams.get('entry.1003')).toBe(DEMO_CODES['GDL-orti'])
  })

  test('non ha il tasto sui cantieri degli altri gruppi', async ({ page }) => {
    await page.goto('/cantieri')
    const other = page.locator('article', { hasText: 'Scambio di semi autunnale' })
    await expect(other).toBeVisible()
    await expect(other.getByRole('link', { name: updateLink })).toHaveCount(0)
  })

  test('/cantieri rispetta la definizione di fatto', async ({ page }) => {
    await page.goto('/cantieri')
    await expectDefinitionOfDone(page)
  })
})

test.describe('chi non sta in «Persone della Riservata»', () => {
  test.use(as('nessuno@example.org'))

  test('trova un rifiuto a parole, senza i cantieri e senza la barra', async ({ page }) => {
    const response = await page.goto('/cantieri')
    expect(response?.status()).toBe(403)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Non puoi entrare')
    await expect(
      page.getByText('Questa parte della Bussola è per Direttivo, Coordinamento e segreteria.'),
    ).toBeVisible()
    await expect(page.getByText('Rete dei mercati contadini')).toHaveCount(0)
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('il rifiuto rispetta la definizione di fatto', async ({ page }) => {
    await page.goto('/riservata')
    await expectDefinitionOfDone(page)
  })
})

test.describe('i cantieri, per tutti', () => {
  test.use(as(DEMO_EMAILS.board))

  test('si leggono stato, passo e quanto sono aggiornati; il cantiere chiuso non c’è', async ({ page }) => {
    await page.goto('/cantieri')
    const current = page.locator('article', { hasText: 'Rete dei mercati contadini' })
    await expect(current).toContainText('In corso · passo 2 di 4')
    await expect(current).toContainText('Aggiornato 3 giorni fa')
    await expect(page.locator('article', { hasText: 'Sito dei prodotti locali' })).toContainText(
      'Da aggiornare · 41 giorni fa',
    )
    await expect(page.getByText('Orto didattico')).toHaveCount(0)
  })
})
