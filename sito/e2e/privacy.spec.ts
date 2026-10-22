import { expect, test } from '@playwright/test'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'
import { expectDefinitionOfDone } from './fatto.ts'

// Il dominio dei soci non ha Access: in locale ci si passa con l'host di prova, senza la mail di prova.
const membersHost = { extraHTTPHeaders: { 'X-Bussola-Prova-Host': 'bussola.retemicrofarm.it' } }

test.describe('il dominio dei soci', () => {
  test.use(membersHost)

  test('l’informativa si apre senza entrare, con la bozza in cima finché il segretario non conferma', async ({
    page,
  }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Come usiamo i dati')
    await expect(page.getByText('Bozza: il testo aspetta la conferma del segretario.')).toBeVisible()
    for (const title of ['Chi tratta i tuoi dati', 'Dove stanno', 'Quanto li teniamo', 'I tuoi diritti'])
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Scrivi a segreteria@retemicrofarm.it' })).toHaveAttribute(
      'href',
      'mailto:segreteria@retemicrofarm.it',
    )
    await expect(page.getByText(/registri degli accessi: mail, indirizzo IP, paese, ora ed esito/)).toBeVisible()
    await expect(page.locator('nav.barra')).toHaveCount(0)
    await expectDefinitionOfDone(page)
  })

  test('ogni altra pagina dice che la Bussola dei soci apre a gennaio, e porta all’informativa', async ({ page }) => {
    await page.goto('/cantieri')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('La Bussola dei soci apre a gennaio.')
    await expect(page.getByRole('link', { name: 'Vai alla Riservata' })).toHaveAttribute(
      'href',
      'https://rami-bussola.pages.dev',
    )
    await expect(page.locator('nav.barra')).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('Scambio di semi')
    await expectDefinitionOfDone(page)
    await page.getByRole('link', { name: 'Come usiamo i dati dei soci' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Come usiamo i dati')
  })
})

test.describe('la Riservata', () => {
  test.use({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': DEMO_EMAILS.board } })

  test('chi entra legge la stessa informativa, con la barra', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Come usiamo i dati')
    await expect(page.locator('nav.barra')).toBeVisible()
  })
})
