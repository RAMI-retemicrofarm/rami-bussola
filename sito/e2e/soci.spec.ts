import { expect, test } from '@playwright/test'
import { MEMBERS_KEY, romeDate, type CalendarDate } from '@bussola/condiviso'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'
import { DEMO_SOCI_COUNTS, DEMO_SOCI_NOW, demoSociSheets } from '../../motore/src/demo-soci.ts'
import { buildMembersSnapshot, readMembersSheets } from '../../motore/src/members-snapshot.ts'
import { memoryWorkbook } from '../../motore/src/memory.ts'

// I numeri dei soci nella Riservata a due date diverse: la prova scrive da sé l'istantanea nel KV locale, come fa il
// seed, e per questo gira da sola (progetto «soci» di playwright.config.ts), dopo le prove che leggono gli stessi numeri.
test.use({ extraHTTPHeaders: { 'X-Bussola-Prova-Mail': DEMO_EMAILS.board } })

/** I numeri dei soci del Foglio inventato al giorno dato, scritti nel KV locale come li scrive il seed. */
function publishMembers(today: CalendarDate) {
  const soci = readMembersSheets(memoryWorkbook(demoSociSheets()), romeDate)
  const content = buildMembersSnapshot(soci.members, soci.payments, soci.settings.dues, today)
  const folder = mkdtempSync(join(tmpdir(), 'bussola-soci-'))
  try {
    const file = join(folder, 'soci.json')
    writeFileSync(file, JSON.stringify({ ...content, publishedAt: new Date().toISOString() }))
    execFileSync(
      'npx',
      ['wrangler', 'kv', 'key', 'put', MEMBERS_KEY, '--path', file, '--binding', 'BUSSOLA', '--local'],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: 'ignore',
      },
    )
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
  return content
}

const DEMO_DAY = romeDate(DEMO_SOCI_NOW)

test('la riga dei rinnovi c’è da gennaio ad aprile, coi numeri del motore, e non negli altri mesi', async ({
  page,
}) => {
  const soci = page.locator('h2:text-is("Soci") ~ .numeri').first()
  const renewals = page.getByText(/^Rinnovi \d{4}: \d+ su \d+ \(\d+%\) · bersaglio: oltre il 92% al 31\/3$/)
  try {
    // Il 5/11/2026, il giorno del Foglio inventato e del seed: i conteggi di sempre, nessuna riga.
    publishMembers(DEMO_DAY)
    await page.goto('/riservata')
    await expect(soci.locator('.card').first()).toHaveText(`${DEMO_SOCI_COUNTS.inGoodStanding} in regola`)
    await expect(renewals).toHaveCount(0)
    // Il 10/2/2027: la riga, coi numeri che il motore conta sullo stesso Foglio.
    const february = publishMembers('2027-02-10')
    expect(february.renewals).toEqual({ year: 2027, renewed: 1, base: 11, percent: 9, until: '03-31' })
    await page.goto('/riservata')
    await expect(renewals).toHaveText('Rinnovi 2027: 1 su 11 (9%) · bersaglio: oltre il 92% al 31/3')
    await expect(soci.locator('.card').first()).toHaveText(`${february.counts.inGoodStanding} in regola`)
    await expect(page.getByText('Contati il 10 febbraio 2027', { exact: false })).toBeVisible()
  } finally {
    // Il KV locale torna com'era per chi prova dopo.
    publishMembers(DEMO_DAY)
  }
  await page.goto('/riservata')
  await expect(renewals).toHaveCount(0)
})
