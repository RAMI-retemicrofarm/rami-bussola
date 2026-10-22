import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'

// Con l'istantanea riservata nel KV locale, entra solo chi sta in «Persone della Riservata».
test.use({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': DEMO_EMAILS.board } })

test('la pagina «Ciao» mostra il valore scritto dal motore, senza violazioni gravi', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'it')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ciao dalla Bussola')
  await expect(page.getByText('«Ciao dal motore della Bussola»')).toBeVisible()

  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})
