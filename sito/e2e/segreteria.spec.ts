import { expect, test, type Page } from '@playwright/test'
import { SHEETS } from '../../motore/src/content.ts'
import { DEMO_EMAILS, demoSheets } from '../../motore/src/demo.ts'
import { DEMO_INSTRUCTIONS_URL, DEMO_OFFICE, DEMO_SOCI_COUNTS, demoSociSheets } from '../../motore/src/demo-soci.ts'
import { SOCI_SHEETS } from '../../motore/src/members.ts'
import type { OfficeCall, PaymentInput } from '../../motore/src/office-api.ts'
import { expectDefinitionOfDone } from './fatto.ts'
import { apriSegreteria, type Rispondi } from './segreteria-finta.ts'
import { ACCOUNT, ADESSO, giorno, motoreVero, sociInventati, type MotoreVero } from './segreteria-motore.ts'

// La pagina della segreteria (T3, flusso D) col motore vero dietro un `google.script.run` finto: le funzioni di
// office.ts su un Foglio soci inventato (demo-soci.ts), nuovo per ogni prova, al 5/11/2026. Si guarda la pagina e poi
// il Foglio e le mail.

const CHI_SEI = 'bussola.segreteria.chiSei'
const { secretary: SEGRETARIO, partTime: PART_TIME, treasurer: TESORIERE } = DEMO_OFFICE
/** I pagamenti di demo-soci: il prossimo numero è P-2026-0016. */
const PAGAMENTI = 30

/** Apre la pagina sul motore dato; con `persona` il «Chi sei?» è già sul dispositivo. */
async function apri(page: Page, motore: MotoreVero, opzioni: { persona?: string; rispondi?: Rispondi } = {}) {
  if (opzioni.persona)
    await page.addInitScript(
      ([chiave, nome]: [string, string]) => {
        try {
          localStorage.setItem(chiave, nome)
        } catch {
          // about:blank, prima della pagina vera
        }
      },
      [CHI_SEI, opzioni.persona] as [string, string],
    )
  const aperta = await apriSegreteria(page, opzioni.rispondi ?? motore.rispondi)
  const argomenti = (nome: OfficeCall) => aperta.chiamate.filter((c) => c.nome === nome).map((c) => c.argomento)
  return { ...aperta, argomenti }
}

/** La definizione di fatto, col Tab che riparte dalla cima come all'apertura della pagina. */
async function fatto(page: Page) {
  await page.locator('.marchio').click()
  await expectDefinitionOfDone(page)
}

const tasto = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const titolo = (page: Page) => page.getByRole('heading', { level: 1 })
const sociVisibili = (page: Page) => page.locator('.socio:visible')
const socio = (page: Page, nome: string) => page.locator('.socio', { hasText: nome })

/** Dalla pagina Soci al riepilogo di un pagamento, scegliendo il socio dall'elenco. */
async function compila(
  page: Page,
  scelta: { cerca: string; scegli: string },
  campi: { riferimento?: string; data?: string } = {},
) {
  await tasto(page, 'Registra un pagamento').click()
  await page.getByLabel('Socio', { exact: true }).fill(scelta.cerca)
  await tasto(page, scelta.scegli).click()
  if (campi.data) await page.getByLabel('Data', { exact: true }).fill(campi.data)
  if (campi.riferimento) await page.getByLabel('Riferimento del bonifico').fill(campi.riferimento)
  await tasto(page, 'Continua').click()
}

test('si apre con lo scheletro, poi Soci: i numeri e i tre filtri tornano col conto a mano', async ({ page }) => {
  const motore = motoreVero()
  const lascia = motore.ferma('officeOpen')
  const { esterne } = await apri(page, motore)
  await expect(page.getByText('Sto aprendo la segreteria…')).toBeVisible()
  lascia()
  await expect(titolo(page)).toHaveText('Soci')
  await expect(
    page.getByText('Chi è in regola si calcola dai pagamenti registrati: nessuno lo scrive a mano.'),
  ).toBeVisible()
  const c = DEMO_SOCI_COUNTS
  await expect(page.locator('.numeri .card')).toHaveText([
    `${c.inGoodStanding}In regola`,
    `${c.dueForRenewal}Da rinnovare`,
    `${c.notInGoodStanding}Non in regola`,
    `${c.paidAhead}Già in regola per il 2027`,
  ])
  await expect(page.getByText(`Soci non receduti: ${c.members} · receduti: ${c.left}`, { exact: true })).toBeVisible()
  // Le carte su due righe: nome, numero e stato sopra, l'ultima quota sotto.
  await expect(socio(page, 'Lucia Abate').locator('.socio-testa')).toHaveText('Lucia Abate · n. 1In regola')
  await expect(page.locator('#sei')).toBeHidden()
  await expect(sociVisibili(page)).toHaveCount(c.members + c.left)

  await tasto(page, `In regola (${c.inGoodStanding})`).click()
  await expect(sociVisibili(page).locator('.stato')).toHaveText(Array(c.inGoodStanding).fill('In regola'))
  await tasto(page, `Da rinnovare (${c.dueForRenewal})`).click()
  await expect(sociVisibili(page).locator('.stato')).toHaveText(Array(c.dueForRenewal).fill('Da rinnovare'))
  await tasto(page, `Tutti (${c.members + c.left})`).click()
  await expect(sociVisibili(page)).toHaveCount(c.members + c.left)

  await expect(socio(page, 'Lucia Abate')).toContainText('Vale per 2026 · bonifico del 15/01/2026')
  await expect(socio(page, 'Elena Marino')).toContainText('Vale per 2026 · dal libro soci')
  await expect(socio(page, 'Bruno Riva')).toContainText('Nessuna quota registrata')
  await expect(socio(page, 'Anna Esposito').locator('.stato')).toHaveText('Receduto')
  await expect(socio(page, 'Marta Galli').locator('.stato')).toHaveText('Già in regola per il 2027')
  await expect(socio(page, 'Donati').locator('.stato')).toHaveText('Non in regola')
  await expect(page.getByRole('link', { name: 'Istruzioni della segreteria' })).toHaveAttribute(
    'href',
    DEMO_INSTRUCTIONS_URL,
  )
  await fatto(page)
  expect(esterne).toEqual([])
})

for (const [chi, email] of [
  ['un account con «entra» no', ACCOUNT.senzaEntrata],
  ['un account sconosciuto', ACCOUNT.sconosciuto],
] as const)
  test(`${chi} non vede nessun dato`, async ({ page }) => {
    await apri(page, motoreVero({ email }))
    await expect(titolo(page)).toHaveText("Non hai accesso a quest'area.")
    await expect(
      page.getByText(
        `Stai usando l'account ${email}. Entra con quello della segreteria: se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a chi cura la Bussola.`,
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page.locator('.socio')).toHaveCount(0)
    await expect(page.locator('.numeri')).toHaveCount(0)
    await expect(page.locator('#piede')).toBeHidden()
    await fatto(page)
  })

test('la part-time sull’account condiviso: «Chi sei?», ricordato dopo il ricaricamento, e il pagamento in attesa del tesoriere, senza mail', async ({
  page,
}) => {
  const motore = motoreVero({ email: ACCOUNT.condiviso })
  const { argomenti } = await apri(page, motore)
  await expect(titolo(page)).toHaveText('Chi sei?')
  await expect(page.getByText("L'account è condiviso: il tuo nome va in «registrato da».")).toBeVisible()
  await expect(
    page.getByText('Me lo ricordo su questo telefono. Se non ci riesco, te lo chiedo di nuovo.'),
  ).toBeVisible()
  await expect(page.locator('main .btn')).toHaveText([PART_TIME, TESORIERE])
  await tasto(page, PART_TIME).click()
  await expect(titolo(page)).toHaveText('Soci')
  await expect(page.locator('#sei')).toHaveText(`Sei ${PART_TIME}·Cambia`)
  // Da T4 anche la part-time ha Pagamenti e Oggi; senza le voci di «Accessi».
  await expect(page.locator('.sezioni button')).toHaveText(['Soci', 'Pagamenti', /^Oggi/])
  await page.reload()
  await expect(titolo(page)).toHaveText('Soci')
  expect(argomenti('officeOpen')).toEqual(['', PART_TIME, PART_TIME])

  await compila(page, { cerca: 'santoro', scegli: 'Elisa Santoro · numero 18' }, { riferimento: '4410' })
  await expect(
    page.getByText(
      'Stai per registrare 30 € da Elisa Santoro, bonifico del 05/11, rif. 4410. Vale per il 2026. Il pagamento va in attesa del tesoriere: conta quando lo conferma.',
    ),
  ).toBeVisible()
  await expect(page.locator('#sei')).toBeHidden()
  // «Registri come» sta sopra «Registra», in corpo normale, e il punto va col tasto «Cambia».
  await expect(page.locator('.chi')).toHaveText(`Registri come ${PART_TIME}·Cambia`)
  await expect(page.locator('.chi')).toHaveCSS('font-size', '17px')
  await expect(page.locator('.chi').getByRole('button')).toHaveText('Cambia')
  const sopra = await page.locator('.chi').boundingBox()
  const registra = await tasto(page, 'Registra').boundingBox()
  expect(sopra && registra && sopra.y + sopra.height <= registra.y).toBe(true)
  await fatto(page)
  await tasto(page, 'Registra').click()
  await expect(
    page.getByText('Registrato. Il pagamento è in attesa del tesoriere: conta quando lo conferma.'),
  ).toBeVisible()
  const riga = motore.pagamento('P-2026-0016')
  expect(riga).toMatchObject({
    "vale per l'anno": 2026,
    riferimento: '4410',
    'registrato da': PART_TIME,
    account: ACCOUNT.condiviso,
    stato: 'in attesa del tesoriere',
  })
  expect(String(riga?.['numero socio'])).toBe('18')
  expect(motore.mails).toEqual([])
  await tasto(page, 'Torna ai soci').click()
  await expect(socio(page, 'Elisa Santoro').locator('.stato')).toHaveText('Da rinnovare')
  await socio(page, 'Elisa Santoro').click()
  await expect(page.locator('article').first().locator('.stato')).toHaveText('In attesa del tesoriere')
  await expect(tasto(page, 'Annulla il pagamento')).toHaveCount(0)
})

test('«Registri come … · Cambia» torna al «Chi sei?», e il modulo resta com’era', async ({ page }) => {
  const motore = motoreVero({ email: ACCOUNT.condiviso })
  await apri(page, motore, { persona: PART_TIME })
  await compila(page, { cerca: 'santoro', scegli: 'Elisa Santoro · numero 18' }, { riferimento: '4411' })
  await page.locator('.chi').getByRole('button', { name: 'Cambia' }).click()
  await expect(titolo(page)).toHaveText('Chi sei?')
  await tasto(page, TESORIERE).click()
  await expect(titolo(page)).toHaveText('Registra un pagamento')
  await expect(page.getByText('Elisa Santoro · numero 18')).toBeVisible()
  await expect(page.getByLabel('Riferimento del bonifico')).toHaveValue('4411')
  expect(await page.evaluate((chiave) => localStorage.getItem(chiave), CHI_SEI)).toBe(TESORIERE)
  await tasto(page, 'Continua').click()
  await expect(page.locator('.chi')).toContainText(`Registri come ${TESORIERE}`)
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Elisa Santoro è in regola per il 2026.')).toBeVisible()
  await expect(page.getByText('Ho mandato la ricevuta a elisa.santoro@example.org.', { exact: true })).toBeVisible()
  expect(motore.pagamento('P-2026-0016')).toMatchObject({ 'registrato da': TESORIERE, stato: 'registrato' })
  expect(motore.mails.map((mail) => mail.to)).toEqual(['elisa.santoro@example.org'])
  await tasto(page, 'Torna ai soci').click()
  await expect(page.locator('.sezioni button')).toHaveCount(3)
  await expect(page.locator('#sei')).toHaveText(`Sei ${TESORIERE}·Cambia`)
})

test('«Sei … · Cambia» sotto il marchio torna al «Chi sei?» e poi a Soci', async ({ page }) => {
  const motore = motoreVero({ email: ACCOUNT.condiviso })
  await apri(page, motore, { persona: PART_TIME })
  await expect(titolo(page)).toHaveText('Soci')
  await fatto(page)
  await page.locator('#sei').getByRole('button', { name: 'Cambia' }).click()
  await expect(titolo(page)).toHaveText('Chi sei?')
  await expect(page.locator('#sei')).toBeHidden()
  await tasto(page, TESORIERE).click()
  await expect(titolo(page)).toHaveText('Soci')
  await expect(page.locator('#sei')).toHaveText(`Sei ${TESORIERE}·Cambia`)
  expect(await page.evaluate((chiave) => localStorage.getItem(chiave), CHI_SEI)).toBe(TESORIERE)
})

test('la ricerca trova per cognome, nome o numero, senza badare alle maiuscole', async ({ page }) => {
  await apri(page, motoreVero())
  const cerca = page.getByLabel('Cerca un socio')
  await cerca.fill('neri')
  await expect(sociVisibili(page)).toHaveText([/Giulia Neri/, /Tommaso Neri/])
  await cerca.fill('NERI giulia')
  await expect(sociVisibili(page)).toHaveText([/Giulia Neri/])
  await cerca.fill('17')
  await expect(sociVisibili(page)).toHaveText([/Bruno Riva/])
  await cerca.fill('Zanetti')
  await expect(sociVisibili(page)).toHaveCount(0)
  await expect(page.getByText('Nessun socio con «Zanetti».', { exact: true })).toBeVisible()
  await tasto(page, 'Da rinnovare (4)').click()
  await cerca.fill('neri')
  await expect(sociVisibili(page)).toHaveCount(0)
  await expect(
    page.getByText('Nessun socio con «neri» fra quelli «Da rinnovare». Tocca «Tutti» per cercare fra tutti.', {
      exact: true,
    }),
  ).toBeVisible()
  await tasto(page, 'Tutti (20)').click()
  await expect(sociVisibili(page)).toHaveText([/Giulia Neri/, /Tommaso Neri/])
})

test('la scheda del socio, coi pagamenti dal più recente, anche gli annullati', async ({ page }) => {
  await apri(page, motoreVero())
  await socio(page, 'Chiara Leone').click()
  await expect(titolo(page)).toHaveText('Chiara Leone')
  await expect(page.locator('main > p.stato')).toHaveText('Da rinnovare')
  const dati = page.locator('main > dl.dati')
  for (const riga of ['Numero9', 'Mailchiara.leone@example.org', 'TipoSostenitore', 'Ammesso il14/03/2020'])
    await expect(dati).toContainText(riga)
  await expect(tasto(page, 'Registra un pagamento per Chiara')).toBeVisible()
  const pagamenti = page.locator('article')
  await expect(pagamenti.locator('h3')).toHaveText(['P-2026-0006', 'P-2025-0004'])
  await expect(pagamenti.first().locator('.stato')).toHaveText('Annullato')
  await expect(pagamenti.first()).toContainText('il bonifico era stato restituito')
  await expect(pagamenti.first().getByRole('button')).toHaveCount(0)
  await expect(pagamenti.nth(1)).toContainText(`Registrato da ${TESORIERE} il 01/03/2025`)
  await expect(pagamenti.nth(1).getByRole('button')).toHaveText(['Annulla il pagamento', "Cambia l'anno"])
  await tasto(page, '‹ Indietro').click()
  await expect(titolo(page)).toHaveText('Soci')
})

test('un bonifico: una riga P-2026-NNNN nel Foglio, il socio in regola e la mail con l’id', async ({ page }) => {
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await tasto(page, 'Registra un pagamento').click()
  await expect(page.getByLabel('Importo')).toHaveValue('30')
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2026-11-05')
  await expect(page.getByRole('radio', { name: 'Bonifico' })).toBeChecked()
  await expect(page.getByLabel('Chi incassa')).toBeHidden()
  await expect(page.getByLabel('Data', { exact: true })).toHaveAccessibleDescription(
    'Quella scritta sulla contabile, non quella di oggi.',
  )
  await page.getByLabel('Socio', { exact: true }).fill('Bellini')
  await tasto(page, 'Marco Bellini · numero 2').click()
  await page.getByLabel('Data', { exact: true }).fill('2026-11-03')
  await tasto(page, 'Continua').click()
  // Il motore rifiuta il bonifico senza riferimento: l'errore sta accanto al campo, letto da aria-live.
  await expect(page.locator('#errore-reference')).toContainText('riferimento')
  await expect(page.locator('#errore-reference')).toHaveAttribute('aria-live', 'polite')
  await expect(page.getByLabel('Riferimento del bonifico')).toHaveAttribute('aria-invalid', 'true')
  await fatto(page)
  await page.getByLabel('Riferimento del bonifico').fill('8842')
  await tasto(page, 'Continua').click()
  await expect(
    page.getByText(
      'Stai per registrare 30 € da Marco Bellini, bonifico del 03/11, rif. 8842. Vale per il 2026. Al socio arriva una mail.',
    ),
  ).toBeVisible()
  await fatto(page)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  await expect(page.getByText('Ho mandato la ricevuta a marco.bellini@example.org.', { exact: true })).toBeVisible()
  await expect(titolo(page)).toHaveText('Pagamento registrato')

  const [registrato] = argomenti('officeRecordPayment') as [PaymentInput]
  expect(registrato.requestKey).toMatch(/^[0-9a-f]{32}$/)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  const riga = motore.pagamento('P-2026-0016')
  expect(riga).toMatchObject({
    "vale per l'anno": 2026,
    importo: 30,
    modo: 'bonifico',
    riferimento: '8842',
    'registrato da': SEGRETARIO,
    account: DEMO_EMAILS.office,
    stato: 'registrato',
    'chiave della registrazione': registrato.requestKey,
  })
  expect(String(riga?.['numero socio'])).toBe('2')
  expect(giorno(riga?.data)).toBe('2026-11-03')
  expect(motore.mails).toHaveLength(1)
  expect(motore.mails[0]).toMatchObject({ to: 'marco.bellini@example.org', subject: 'Quota ricevuta, sei in regola' })
  expect(motore.mails[0]?.body).toContain('P-2026-0016')

  await tasto(page, 'Torna ai soci').click()
  const c = DEMO_SOCI_COUNTS
  await expect(page.locator('.numeri .card').first()).toHaveText(`${c.inGoodStanding + 1}In regola`)
  await expect(page.locator('.numeri .card').nth(1)).toHaveText(`${c.dueForRenewal - 1}Da rinnovare`)
  await expect(socio(page, 'Marco Bellini').locator('.stato')).toHaveText('In regola')
  await expect(socio(page, 'Marco Bellini')).toContainText('Vale per 2026 · bonifico del 03/11/2026')
})

test('il doppio tocco su «Registra» lascia una riga e una mail, e l’attesa si vede', async ({ page }) => {
  await page.clock.install()
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await compila(page, { cerca: '2', scegli: 'Marco Bellini · numero 2' }, { riferimento: '9001' })
  const lascia = motore.ferma('officeRecordPayment')
  await tasto(page, 'Registra e manda la mail').dblclick()
  await page.clock.fastForward(1100)
  await expect(tasto(page, 'Sto registrando…')).toBeDisabled()
  await page.clock.fastForward(8000)
  await expect(page.getByText('Ci mette più del solito. Non toccare di nuovo.')).toBeVisible()
  lascia()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  expect(argomenti('officeRecordPayment')).toHaveLength(1)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  expect(motore.mails).toHaveLength(1)
})

test('il possibile doppione non scrive niente; «È un altro pagamento» con la nota registra per l’anno libero', async ({
  page,
}) => {
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await compila(page, { cerca: 'testa', scegli: 'Nicola Testa · numero 19' }, { riferimento: '7777' })
  await tasto(page, 'Registra e manda la mail').click()
  await expect(
    page.getByText(
      'Questo pagamento sembra già registrato: Nicola Testa, 30 €, rif. 60013, registrato dal tesoriere il 15/03. Non lo registro due volte.',
    ),
  ).toBeVisible()
  await expect(titolo(page)).toHaveText('Possibile doppione')
  await expect(page.locator('.avviso strong')).toHaveText('Possibile doppione.')
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
  expect(motore.mails).toEqual([])
  await expect(tasto(page, 'Non registrare')).toHaveClass(/^btn$/)
  await fatto(page)
  await tasto(page, 'È un altro pagamento').click()
  await expect(page.getByText('Lo registro per il 2027.')).toBeVisible()
  await tasto(page, 'Registra').click()
  await expect(page.locator('#errore-note')).toHaveText('Scrivi una nota: perché è un altro pagamento.')
  await page.getByLabel('Nota (obbligatoria)').fill('quota di due anni')
  await tasto(page, 'Registra').click()
  await expect(page.getByText('Registrato. Nicola Testa è in regola per il 2027.')).toBeVisible()
  const [primo, secondo] = argomenti('officeRecordPayment') as [PaymentInput, PaymentInput]
  expect(secondo).toMatchObject({ memberNumber: '19', notADuplicate: true })
  expect(secondo.requestKey).not.toBe(primo.requestKey)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  expect(motore.pagamento('P-2026-0016')).toMatchObject({ "vale per l'anno": 2027, riferimento: '7777' })
  expect(motore.pagamento('P-2026-0016')?.['motivo o nota']).toContain('quota di due anni')
  expect(motore.mails).toHaveLength(1)
})

test('«Non registrare» torna ai soci senza scrivere niente', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  await compila(page, { cerca: 'testa', scegli: 'Nicola Testa · numero 19' }, { riferimento: '7777' })
  await tasto(page, 'Registra e manda la mail').click()
  await tasto(page, 'Non registrare').click()
  await expect(titolo(page)).toHaveText('Soci')
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
})

test('il doppione di un pagamento già registrato in contanti: si ferma, senza «rif.»', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  await tasto(page, 'Registra un pagamento').click()
  await page.getByLabel('Socio', { exact: true }).fill('fabbri')
  await tasto(page, 'Luca Fabbri · numero 6').click()
  await page.getByRole('radio', { name: 'Contanti' }).check()
  await page.getByLabel('Chi incassa').fill('Luisa al banchetto')
  await page.getByLabel('Data', { exact: true }).fill('2026-11-02')
  await tasto(page, 'Continua').click()
  await tasto(page, 'Registra e manda la mail').click()
  // P-2026-0003 di demo-soci.ts: contanti per il 2026, registrati dal tesoriere il 23/05/2026.
  await expect(titolo(page)).toHaveText('Possibile doppione')
  await expect(page.locator('.avviso')).toHaveText(
    'Possibile doppione. Questo pagamento sembra già registrato: Luca Fabbri, 30 € per il 2026, registrato dal tesoriere il 23/05. Non lo registro due volte.',
  )
  await expect(page.locator('main')).not.toContainText('rif.')
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
  expect(motore.mails).toEqual([])
  await fatto(page)
})

test('il socio receduto: l’avviso prima di registrare, e la conferma non dice «in regola»', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  await compila(page, { cerca: 'esposito', scegli: 'Anna Esposito · numero 5' }, { riferimento: '6001' })
  await expect(
    page.getByText(
      'Stai per registrare 30 € da Anna Esposito, bonifico del 05/11, rif. 6001. Vale per il 2026. Al socio arriva una mail.',
    ),
  ).toBeVisible()
  await expect(page.locator('main > p.stato.warn')).toHaveText('Anna Esposito ha lasciato RAMI il 30/06/2026.')
  await expect(page.locator('main > p.stato.warn .tri')).toHaveCount(1)
  await fatto(page)
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.locator('main > p.stato').first()).toHaveText(
    'Registrato per il 2026. Lo stato di Anna Esposito è «Receduto».',
  )
  await expect(page.getByText('è in regola')).toHaveCount(0)
  await expect(page.getByText('Ho mandato la ricevuta a anna.esposito@example.org.', { exact: true })).toBeVisible()
  expect(motore.pagamento('P-2026-0016')).toMatchObject({ "vale per l'anno": 2026, riferimento: '6001' })
})

test('lo stesso riferimento con un altro socio non è un doppione', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  // 55001 è il bonifico di 60 € di Giulia e Tommaso Neri.
  await compila(page, { cerca: 'bellini', scegli: 'Marco Bellini · numero 2' }, { riferimento: '55001' })
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  expect(motore.pagamenti().filter((riga) => riga.riferimento === '55001')).toHaveLength(3)
  expect(motore.mails.map((mail) => mail.to)).toEqual(['marco.bellini@example.org'])
})

test('i contanti con «Chi incassa» diverso da chi registra; senza rete la ricevuta di carta, e ciò che è scritto resta', async ({
  page,
  context,
}) => {
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await tasto(page, 'Registra un pagamento').click()
  await page.getByLabel('Socio', { exact: true }).fill('donati')
  await tasto(page, 'Paolo Donati · numero 4').click()
  const ricevutaDiCarta =
    'Contanti a un raduno: chi incassa e non è della segreteria scrive una ricevuta di carta (numero socio, importo, data, chi ha incassato) e la dà al tesoriere, che la registra.'
  await expect(page.getByText(ricevutaDiCarta)).toBeHidden()
  await page.getByRole('radio', { name: 'Contanti' }).check()
  await expect(page.getByLabel('Riferimento del bonifico')).toBeHidden()
  await expect(page.getByLabel('Chi incassa')).toHaveValue(SEGRETARIO)
  // La nota della ricevuta di carta sta sotto «Chi incassa», solo coi contanti, e non più nel piede.
  await expect(page.getByLabel('Chi incassa')).toHaveAccessibleDescription(ricevutaDiCarta)
  await expect(page.locator('#piede')).not.toContainText('Contanti a un raduno')
  await expect(page.getByLabel('Data', { exact: true })).toHaveAccessibleDescription('Il giorno in cui hai incassato.')
  await page.getByLabel('Chi incassa').fill('Luisa al banchetto')
  await page.getByLabel('Note (facoltativa)').fill('al tavolo del raduno')
  await tasto(page, 'Continua').click()
  await expect(
    page.getByText(
      'Stai per registrare 30 € da Paolo Donati, contanti del 05/11, incassati da Luisa al banchetto. Vale per il 2026. Al socio arriva una mail.',
    ),
  ).toBeVisible()
  await context.setOffline(true)
  await tasto(page, 'Registra e manda la mail').click()
  await expect(
    page.getByText(
      "Qui non c'è connessione. Scrivi una ricevuta di carta (numero socio, importo, data, chi ha incassato) e consegnala al tesoriere, che la registra.",
    ),
  ).toBeVisible()
  expect(argomenti('officeRecordPayment')).toHaveLength(0)
  await tasto(page, 'Torna indietro').click()
  await expect(page.getByLabel('Note (facoltativa)')).toHaveValue('al tavolo del raduno')
  await expect(page.getByLabel('Chi incassa')).toHaveValue('Luisa al banchetto')
  await context.setOffline(false)
  await tasto(page, 'Continua').click()
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Paolo Donati è in regola per il 2026.')).toBeVisible()
  expect(motore.pagamento('P-2026-0016')).toMatchObject({
    modo: 'contanti',
    riferimento: '',
    'chi incassa': 'Luisa al banchetto',
    'registrato da': SEGRETARIO,
  })
  expect(motore.pagamento('P-2026-0016')?.['motivo o nota']).toContain('al tavolo del raduno')
  expect(motore.mails.map((mail) => mail.to)).toEqual(['paolo.donati@example.org'])
  expect(motore.mails[0]?.body).toContain('contanti del')
  // «Chi incassa» si legge anche nella scheda del socio, sul pagamento.
  await tasto(page, 'Torna ai soci').click()
  await socio(page, 'Paolo Donati').click()
  const pagamento = page.locator('article').filter({ hasText: 'P-2026-0016' })
  await expect(pagamento).toContainText('Chi incassa')
  await expect(pagamento).toContainText('Luisa al banchetto')
})

test('il cognome che non c’è, poi «Registra senza socio»: una riga col numero socio vuoto', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  await tasto(page, 'Registra un pagamento').click()
  await page.getByLabel('Socio', { exact: true }).fill('Zanetti')
  await expect(
    page.getByText(
      'Nessun socio con «Zanetti». Prova col numero socio o solo col cognome. Se non è un socio, registra senza socio.',
    ),
  ).toBeVisible()
  await tasto(page, 'Registra senza socio').click()
  await expect(page.getByText('Senza socio: va in «Da abbinare».')).toBeVisible()
  await page.getByLabel('Riferimento del bonifico').fill('9035')
  await tasto(page, 'Continua').click()
  await expect(
    page.getByText('Stai per registrare 30 € senza socio, bonifico del 05/11, rif. 9035. Va in «Da abbinare».'),
  ).toBeVisible()
  await tasto(page, 'Registra').click()
  await expect(page.getByText('Registrato senza socio: va in «Da abbinare».')).toBeVisible()
  expect(motore.pagamento('P-2026-0016')).toMatchObject({ 'numero socio': '', riferimento: '9035' })
  expect(motore.mails).toEqual([])
})

test('annulla e cambia l’anno col motivo: lo stato del socio cambia e la nota va nel Foglio', async ({ page }) => {
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await socio(page, 'Sara Carli').click()
  const pagamento = page.locator('article', { hasText: 'P-2026-0002' })
  await pagamento.getByRole('button', { name: 'Annulla il pagamento' }).click()
  await expect(titolo(page)).toHaveText('Vuoi annullare questo pagamento?')
  await fatto(page)
  await tasto(page, 'No, torna alla scheda').click()
  await expect(titolo(page)).toHaveText('Sara Carli')
  await pagamento.getByRole('button', { name: 'Annulla il pagamento' }).click()
  await tasto(page, 'Sì, annulla questo pagamento').click()
  await expect(page.locator('#errore-motivo')).toHaveText('Scrivi il motivo: resta nel registro accanto al pagamento.')
  expect(argomenti('officeCancelPayment')).toHaveLength(0)
  await page.getByLabel('Motivo (obbligatorio)').fill('Bonifico registrato due volte')
  await tasto(page, 'Sì, annulla questo pagamento').click()
  await expect(page.getByText('Pagamento P-2026-0002 annullato.')).toBeVisible()
  await expect(page.locator('main > p.stato').first()).toHaveText('Da rinnovare')
  await expect(pagamento.locator('.stato')).toHaveText('Annullato')
  expect(motore.pagamento('P-2026-0002')?.stato).toBe('annullato')
  expect(motore.pagamento('P-2026-0002')?.['motivo o nota']).toContain('Bonifico registrato due volte')

  await tasto(page, '‹ Indietro').click()
  await socio(page, 'Luca Fabbri').click()
  await page.locator('article', { hasText: 'P-2026-0003' }).getByRole('button', { name: "Cambia l'anno" }).click()
  await page.getByLabel("Vale per l'anno").selectOption('2027')
  await tasto(page, "Cambia l'anno").click()
  await expect(page.locator('#errore-motivo')).toHaveText('Scrivi il motivo: resta nel registro accanto al pagamento.')
  await page.getByLabel('Motivo (obbligatorio)').fill('Pagato per l’anno dopo')
  await tasto(page, "Cambia l'anno").click()
  await expect(page.getByText('Ora il pagamento P-2026-0003 vale per il 2027.')).toBeVisible()
  await expect(page.locator('main > p.stato').first()).toHaveText('Già in regola per il 2027')
  expect(motore.pagamento('P-2026-0003')?.["vale per l'anno"]).toBe(2027)
  expect(motore.pagamento('P-2026-0003')?.['motivo o nota']).toContain('Pagato per l’anno dopo')
  expect(argomenti('officeChangeYear')).toEqual([
    { person: SEGRETARIO, paymentId: 'P-2026-0003', validYear: 2027, reason: 'Pagato per l’anno dopo' },
  ])
})

test('«Oggi» del segretario: il cambio in «Accessi» di 10 giorni fa sì, quello di 31 no; le condivisioni', async ({
  page,
}) => {
  let motore = motoreVero({
    condivisioni: {
      checkedOn: '2026-11-05',
      findings: [{ where: 'il Foglio soci', account: 'qualcuno@example.org', access: 'modifica' }],
    },
  })
  await apri(page, motore, { rispondi: (nome, argomento) => motore.rispondi(nome, argomento) })
  // Da Soci si vede già che c'è da guardare: parola e triangolo, non solo il colore. Con la condivisione fuori
  // dall'elenco conta anche l'adempimento in ritardo del Foglio contenuti inventato (SCA-0001).
  const oggi = page.locator('.sezioni button').nth(2)
  await expect(oggi).toHaveText('Oggi · 2 da guardare')
  await expect(oggi.locator('.stato.warn .tri')).toHaveCount(1)
  await oggi.click()
  await expect(titolo(page)).toHaveText('Oggi')
  await expect(oggi).toHaveAttribute('aria-current', 'page')
  const cambi = page.locator('h2:text-is("Cambi in «Accessi» negli ultimi 30 giorni") + .card .riga')
  await expect(cambi).toHaveText([
    `26/10 alle 16:40 la riga 4 di «Accessi» è cambiata: ora «${TESORIERE} · ${ACCOUNT.condiviso}». L'ha fatto ${DEMO_EMAILS.office}.`,
  ])
  await expect(page.getByText('05/10')).toHaveCount(0)
  await expect(page.getByText('Il Foglio soci', { exact: true })).toBeVisible()
  await expect(page.getByText('qualcuno@example.org')).toBeVisible()
  await expect(page.locator('h2:text-is("Condivisioni fuori dall\'elenco") ~ .card .stato.bad')).toHaveText(
    "Fuori dall'elenco, può modificare",
  )
  await expect(
    page.getByText("Togli l'accesso dal Foglio soci, oppure aggiungi la persona in «Accessi».", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Ultimo controllo: 05/11/2026.')).toBeVisible()
  await expect(page.getByText('Il resto di «Oggi» arriva con la prossima versione.')).toHaveCount(0)
  await expect(page.getByText('Il controllo delle condivisioni', { exact: false })).toHaveCount(0)
  await fatto(page)

  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-05', findings: [] } })
  await page.reload()
  await expect(oggi).toHaveText('Oggi · 1 da guardare')
  await oggi.click()
  await expect(page.getByText("Nessuna condivisione fuori dall'elenco. Ultimo controllo: 05/11/2026.")).toBeVisible()

  // Due giorni senza controllo vanno ancora; dal terzo, l'avviso.
  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-03', findings: [] } })
  await page.reload()
  await oggi.click()
  await expect(page.getByText("Nessuna condivisione fuori dall'elenco. Ultimo controllo: 03/11/2026.")).toBeVisible()
  await expect(page.locator('main > .stato.warn')).toHaveCount(0)
  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-02', findings: [] } })
  await page.reload()
  await oggi.click()
  await expect(page.locator('main > .stato.warn')).toHaveText(
    'Il controllo delle condivisioni non gira dal 02/11/2026: avvisa chi cura la Bussola.',
  )
  await fatto(page)

  motore = motoreVero()
  await page.reload()
  await oggi.click()
  await expect(page.locator('main > .stato.warn')).toHaveText(
    'Il controllo delle condivisioni non ha ancora girato: avvisa chi cura la Bussola.',
  )
})

// --- T4: «Oggi» completa, Pagamenti, il tesoriere, le scadenze e il libro soci.

const sezione = (page: Page, titolo: string) => page.locator(`h2:text-is("${titolo}") ~ *`)
const cardDopo = (page: Page, titolo: string) => page.locator(`h2:text-is("${titolo}") + .card`)

test('«Oggi» completa: i numeri, i pagamenti da seguire, l’ultima registrazione, le scadenze col ritardo in rosso, «Da controllare», «Salute», il libro soci', async ({
  page,
}) => {
  const motore = motoreVero()
  await apri(page, motore)
  await page.locator('.sezioni button').nth(2).click()
  await expect(titolo(page)).toHaveText('Oggi')
  const c = DEMO_SOCI_COUNTS
  await expect(page.locator('.numeri .card')).toHaveText([
    `${c.inGoodStanding}In regola`,
    `${c.dueForRenewal}Da rinnovare`,
    `${c.notInGoodStanding}Non in regola`,
    `${c.paidAhead}Già in regola per il 2027`,
  ])
  await expect(page.getByText(`Soci non receduti: ${c.members} · receduti: ${c.left}`, { exact: true })).toBeVisible()
  const seguire = cardDopo(page, 'Pagamenti da seguire')
  await expect(seguire).toContainText('2 da abbinare')
  await expect(seguire).toContainText('1 pagamento in attesa del tesoriere')
  await expect(seguire).toContainText('2 pagamenti in contanti da consegnare: 60 €')
  await expect(seguire.locator('.stato.ok')).toHaveText(
    'Ultima registrazione: P-2026-0007 del 30/10/2026, 6 giorni fa.',
  )
  // L'adempimento in ritardo in cima, in rosso e a parole, con chi lo segue; poi le prossime tre.
  const scadenze = cardDopo(page, 'Prossime scadenze')
  const prima = scadenze.locator('.riga').first()
  await expect(prima).toContainText("Quota annuale all'ente di normazione")
  await expect(prima.locator('.stato.bad')).toHaveText('In ritardo di 5 giorni')
  await expect(prima).toContainText('Segue: il tesoriere')
  await expect(scadenze.locator('.riga')).toHaveCount(5)
  await expect(scadenze.locator('.riga').nth(1)).toContainText('Contare i messaggi senza risposta da più di 5 giorni')
  await expect(scadenze.locator('.riga').nth(1).locator('.stato')).toHaveText('Fra 6 giorni')
  await expect(scadenze.locator('summary')).toHaveText('Altre 1 nei prossimi 30 giorni')
  await expect(scadenze).not.toContainText('Bando per i mercati contadini')
  // T6: le due righe «da scrivere» del Foglio contenuti inventato.
  await expect(page.getByText('Impegni da scrivere: 2', { exact: true })).toBeVisible()
  // Part-time e tesoriere condividono l'account, e il tesoriere può confermare: «Oggi» lo dice.
  await expect(sezione(page, 'Da controllare').first().locator('li')).toHaveText([
    'La scadenza «Nomina per la piattaforma della newsletter» non ha nessuno che la segua.',
    `L’account ${ACCOUNT.condiviso} ha due righe in «Accessi», e una può confermare: così si può confermare un proprio pagamento.`,
  ])
  await expect(sezione(page, 'Salute').first()).toHaveText('«Salute» è vuota: il motore non ha ancora fatto un giro.')
  await expect(page.getByText('Nessun libro soci nel Drive finora', { exact: false })).toBeVisible()
  await fatto(page)

  // «Fatta» scrive la data nel Foglio contenuti, e la scadenza esce.
  await prima.getByRole('button', { name: 'Fatta' }).click()
  await expect(page.getByRole('status')).toHaveText(
    "«Quota annuale all'ente di normazione» segnata fatta il 05/11/2026.",
  )
  expect(giorno(motore.scadenza('SCA-0001')?.['fatta il'])).toBe('2026-11-05')
  await expect(cardDopo(page, 'Prossime scadenze').locator('.riga')).toHaveCount(4)
  await expect(page.locator('.sezioni button').nth(2)).toHaveText('Oggi')

  // «Salva nel Drive»: la copia di oggi, in sola lettura, senza mail né telefoni.
  await tasto(page, 'Salva nel Drive').click()
  await expect(page.getByRole('status')).toHaveText('Libro soci salvato nel Drive: «Libro soci al 2026-11-05».')
  expect(motore.drive.map((file) => file.name)).toEqual(['Libro soci al 2026-11-05'])
  expect(motore.drive[0]?.rows[0]).not.toContain('mail')
  await expect(page.getByText('Ultimo libro soci nel Drive: 05/11/2026.')).toBeVisible()
  await expect(page.getByRole('link', { name: "Apri l'ultimo" })).toHaveAttribute('href', /libro-1/)
  await fatto(page)
})

test('la misura del mese: «Fatta» chiede il numero e lo scrive in «Misure», riga O9; non va in rosso', async ({
  page,
}) => {
  const contenuti = demoSheets(ADESSO)
  contenuti[SHEETS.deadlines.name]?.push([
    'MIS-O9-2026-10',
    'Conta i messaggi senza risposta da più di 5 giorni (mail e Instagram)',
    'misura',
    '2026-10-31',
    'il segretario',
    '',
    '',
    'no',
  ])
  const motore = motoreVero({ contenuti })
  await apri(page, motore)
  await page.locator('.sezioni button').nth(2).click()
  const riga = cardDopo(page, 'Prossime scadenze').locator('.riga', { hasText: 'mail e Instagram' })
  await expect(riga.locator('.stato')).toHaveText('Passata da 5 giorni')
  await expect(riga.locator('.stato.bad')).toHaveCount(0)
  await riga.getByRole('button', { name: 'Fatta' }).click()
  await expect(titolo(page)).toHaveText('Conta i messaggi senza risposta da più di 5 giorni (mail e Instagram)')
  await tasto(page, 'Segna fatta').click()
  await expect(page.locator('#errore-misura')).toHaveText('Scrivi un numero intero, anche 0.')
  await fatto(page)
  await page.getByLabel('Quanti messaggi sono senza risposta da più di 5 giorni?').fill('3')
  await tasto(page, 'Segna fatta').click()
  await expect(page.getByRole('status')).toContainText('segnata fatta: 3 nella scheda «Misure».')
  expect(giorno(motore.scadenza('MIS-O9-2026-10')?.['fatta il'])).toBe('2026-11-05')
  const o9 = motore.misure().find((row) => String(row['obiettivo']).startsWith('O9'))
  expect(o9?.['prima']).toBe(3)
})

test('un’ultima registrazione di più di 7 giorni fa va in rosso, a parole', async ({ page }) => {
  const sheets = demoSociSheets()
  const colonna = SOCI_SHEETS.payments.columns.indexOf('registrato il')
  for (const riga of (sheets[SOCI_SHEETS.payments.name] ?? []).slice(1))
    if (String(riga[colonna]) > '2026-10-20') riga[colonna] = '2026-10-20'
  await apri(page, motoreVero({ sheets }))
  await expect(page.locator('.sezioni button').nth(2)).toHaveText('Oggi · 2 da guardare')
  await page.locator('.sezioni button').nth(2).click()
  await expect(cardDopo(page, 'Pagamenti da seguire').locator('.stato.bad')).toHaveText(
    "Nessuna registrazione da 16 giorni: l'ultima è P-2026-0015 del 20/10/2026.",
  )
  await fatto(page)
})

test('Pagamenti, dal tesoriere: da abbinare, «Conferma» che fa contare, «Ricevuti» che toglie dai contanti', async ({
  page,
}) => {
  const motore = motoreVero({ email: ACCOUNT.condiviso })
  await apri(page, motore, { persona: TESORIERE })
  await page.locator('.sezioni button').nth(1).click()
  await expect(titolo(page)).toHaveText('Pagamenti')
  const daAbbinare = cardDopo(page, 'Da abbinare').locator('.riga')
  await expect(daAbbinare).toHaveText([
    /In banca il 02\/11\/2026: 30 €, «quota Verdi», rif\. TRN 90210\. Nessuna registrazione\./,
    /P-2026-0015, 30 € del 25\/10\/2026: registrato senza socio, rif\. 60015\./,
  ])
  await expect(daAbbinare.first().getByRole('button')).toHaveText(['Registra questo bonifico', 'Non è una quota'])
  await expect(daAbbinare.nth(1).getByRole('button')).toHaveText('Abbina a un socio')
  const attesa = page.locator('h2:text-is("In attesa del tesoriere") + article')
  await expect(attesa).toContainText('P-2026-0007')
  await expect(attesa.locator('.stato').first()).toHaveText('In attesa del tesoriere')
  await expect(attesa).toContainText('Giorgio Mancini · n. 10')
  await expect(page.getByText('2 pagamenti in contanti da consegnare: 60 €')).toBeVisible()
  await expect(page.getByText('4 righe in «Estratto conto», 3 abbinate. Ultima riga: 02/11/2026.')).toBeVisible()
  await fatto(page)

  await attesa.getByRole('button', { name: 'Conferma' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Pagamento P-2026-0007 di Giorgio Mancini confermato: conta da adesso.',
  )
  await expect(page.getByText('Nessun pagamento in attesa del tesoriere.')).toBeVisible()
  expect(motore.pagamento('P-2026-0007')?.stato).toBe('registrato')
  expect(motore.mails.map((mail) => mail.to)).toEqual(['giorgio.mancini@example.org'])

  const contanti = page.locator('h2:text-is("Contanti da consegnare") ~ article', { hasText: 'P-2026-0003' })
  await contanti.getByRole('button', { name: 'Ricevuti' }).click()
  await expect(page.getByRole('status')).toHaveText('Contanti di P-2026-0003 di Luca Fabbri ricevuti.')
  await expect(page.getByText('1 pagamento in contanti da consegnare: 30 €')).toBeVisible()
  expect(giorno(motore.pagamento('P-2026-0003')?.['contanti ricevuti il'])).toBe('2026-11-05')
  await page.locator('.sezioni button').first().click()
  await socio(page, 'Giorgio Mancini').click()
  await expect(page.locator('main > p.stato').first()).toHaveText('In regola')
  await expect(page.locator('article', { hasText: 'P-2026-0007' }).locator('.stato')).toHaveText([
    'Contanti da consegnare',
  ])
})

test('chi non ha il permesso non vede «Conferma» né «Ricevuti»; su un pagamento registrato da sé «Conferma» no, «Ricevuti» sì', async ({
  page,
  context,
}) => {
  await apri(page, motoreVero())
  await page.locator('.sezioni button').nth(1).click()
  await expect(page.getByRole('button', { name: 'Conferma' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ricevuti' })).toHaveCount(0)
  await page.locator('.sezioni button').first().click()
  await socio(page, 'Luca Fabbri').click()
  await expect(page.getByRole('button', { name: 'Ricevuti' })).toHaveCount(0)

  // La part-time col permesso di confermare: il suo P-2026-0007 non ha «Conferma», ma ha «Ricevuti».
  const sheets = demoSociSheets()
  sheets[SOCI_SHEETS.access.name]?.splice(2, 1, [
    PART_TIME,
    ACCOUNT.condiviso,
    'segreteria part-time',
    'sì',
    'no',
    'sì',
  ])
  const altra = await context.newPage()
  await apri(altra, motoreVero({ email: ACCOUNT.condiviso, sheets }), { persona: PART_TIME })
  await altra.locator('.sezioni button').nth(1).click()
  const attesa = altra.locator('h2:text-is("In attesa del tesoriere") + article')
  await expect(attesa).toContainText('P-2026-0007')
  await expect(attesa.getByRole('button', { name: 'Conferma' })).toHaveCount(0)
  await expect(attesa.getByRole('button', { name: 'Ricevuti' })).toHaveCount(1)
  const contanti = altra.locator('h2:text-is("Contanti da consegnare") ~ article')
  await expect(contanti.getByRole('button', { name: 'Ricevuti' })).toHaveCount(2)
  await fatto(altra)
})

test('«Abbina a un socio» un pagamento senza socio, e «Registra questo bonifico» con i campi già scritti', async ({
  page,
}) => {
  const motore = motoreVero()
  await apri(page, motore)
  await page.locator('.sezioni button').nth(1).click()
  await tasto(page, 'Abbina a un socio').click()
  await expect(titolo(page)).toHaveText('Abbina a un socio')
  await page.getByLabel('Socio', { exact: true }).fill('donati')
  await tasto(page, 'Paolo Donati · numero 4').click()
  await expect(page.getByRole('status')).toHaveText('P-2026-0015 abbinato a Paolo Donati. Ho mandato la ricevuta.')
  expect(String(motore.pagamento('P-2026-0015')?.['numero socio'])).toBe('4')
  await expect(cardDopo(page, 'Da abbinare').locator('.riga')).toHaveCount(1)
  await tasto(page, 'Registra questo bonifico').click()
  await expect(titolo(page)).toHaveText('Registra un pagamento')
  await expect(page.getByLabel('Importo')).toHaveValue('30')
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2026-11-02')
  await expect(page.getByLabel('Riferimento del bonifico')).toHaveValue('TRN 90210')
  await fatto(page)
})

test('l’estratto conto incollato: le righe nuove si abbinano, quelle già incollate si scartano', async ({ page }) => {
  const motore = motoreVero()
  await apri(page, motore)
  await page.locator('.sezioni button').nth(1).click()
  const righe = ['2026-11-02\t30\tquota Verdi\tTRN 90210', '2026-11-03\t30\tQuota RAMI 2026 socio n. 2\tTRN 7001'].join(
    '\n',
  )
  await page.getByLabel('Oppure incolla le righe').fill(righe)
  await tasto(page, 'Importa').click()
  await expect(page.getByRole('status')).toHaveText(
    'Estratto conto importato: 1 riga nuova, 1 già incollata, scartata.',
  )
  expect(motore.banca()).toHaveLength(5)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
  await expect(cardDopo(page, 'Da abbinare').locator('.riga')).toHaveCount(3)
  await page.getByLabel('Oppure incolla le righe').fill(righe)
  await tasto(page, 'Importa').click()
  await expect(page.getByRole('status')).toHaveText(
    'Estratto conto importato: 0 righe nuove, 2 già incollate, scartate.',
  )
  expect(motore.banca()).toHaveLength(5)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
})

test('«Non è una quota»: il motivo è obbligatorio, poi la riga esce da «Da abbinare» e si conta a parte; reincollata, il motivo resta', async ({
  page,
}) => {
  const motore = motoreVero()
  await apri(page, motore)
  await page.locator('.sezioni button').nth(1).click()
  const righe = [
    '2026-11-03\t45\traduno rete microfarm 2027 (solo soci)\tCRO 70101',
    '2026-11-04\t15\tmagliette\tCRO 70102',
  ].join('\n')
  await page.getByLabel('Oppure incolla le righe').fill(righe)
  await tasto(page, 'Importa').click()
  await expect(page.getByRole('status')).toHaveText('Estratto conto importato: 2 righe nuove, 1 ignorata.')
  await expect(page.locator('summary', { hasText: 'Iscrizioni al Raduno: 1' })).toBeVisible()
  await expect(cardDopo(page, 'Da abbinare').locator('.riga')).toHaveCount(3)

  // I tasti di ogni riga hanno come descrizione il testo della riga: chi non la vede sa di quale si parla.
  const magliette = cardDopo(page, 'Da abbinare').locator('.riga', { hasText: 'magliette' })
  const nonQuota = magliette.getByRole('button', { name: 'Non è una quota' })
  await expect(nonQuota).toHaveAccessibleDescription(/In banca il 04\/11\/2026: 15 €, «magliette»/)
  await nonQuota.click()
  await expect(titolo(page)).toHaveText('Non è una quota?')
  await expect(titolo(page)).toBeFocused()
  const motivo = page.getByLabel('Motivo (obbligatorio)')
  await expect(motivo).not.toHaveAttribute('maxlength')
  await expect(motivo).toHaveAccessibleDescription(/al massimo 100 segni/)
  await tasto(page, 'Sì, non è una quota').click()
  await expect(page.locator('#errore-motivo')).toHaveText('Scrivi il motivo, per esempio «donazione» o «magliette».')
  await expect(motivo).toHaveAttribute('aria-invalid', 'true')
  await expect(motivo).toBeFocused()
  await fatto(page)
  await motivo.fill('magliette del banchetto')
  await tasto(page, 'Sì, non è una quota').click()
  await expect(page.getByRole('status')).toHaveText(
    'La riga del 04/11/2026 da 15 € ora è fra quelle che non sono quote: «magliette del banchetto».',
  )
  await expect(page.locator('summary', { hasText: 'Non sono quote: 1' })).toBeVisible()
  await page.locator('summary', { hasText: 'Non sono quote: 1' }).click()
  // La riga del Foglio, con l'intestazione nella riga 1: la cella da svuotare se il motivo è sbagliato.
  const rigaFoglio = motore.banca().length + 1
  await expect(
    page.getByText(
      `In banca il 04/11/2026: 15 €, «magliette», rif. CRO 70102. Motivo: magliette del banchetto (riga ${rigaFoglio}).`,
    ),
  ).toBeVisible()
  await expect(cardDopo(page, 'Da abbinare').locator('.riga')).toHaveCount(2)
  expect(motore.banca().at(-1)?.['ignorato perché']).toBe('magliette del banchetto')
  await fatto(page)

  await page.getByLabel('Oppure incolla le righe').fill(righe)
  await tasto(page, 'Importa').click()
  await expect(page.getByRole('status')).toHaveText(
    'Estratto conto importato: 0 righe nuove, 2 già incollate, scartate.',
  )
  expect(motore.banca().at(-1)?.['ignorato perché']).toBe('magliette del banchetto')
  await expect(page.locator('summary', { hasText: 'Non sono quote: 1' })).toBeVisible()
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI)
})

test('con molte iscrizioni al Raduno il modulo dell’estratto conto viene prima, e gli elenchi sono chiusi', async ({
  page,
}) => {
  const motore = motoreVero()
  await apri(page, motore)
  await page.locator('.sezioni button').nth(1).click()
  const righe = Array.from(
    { length: 40 },
    (_, i) => `2026-11-03\t45\traduno rete microfarm 2027 (solo soci)\tCRO ${80100 + i}`,
  ).join('\n')
  await page.getByLabel('Oppure incolla le righe').fill(righe)
  await tasto(page, 'Importa').click()
  await expect(page.getByRole('status')).toHaveText('Estratto conto importato: 40 righe nuove, 40 ignorate.')
  await expect(page.getByText(/40 iscrizioni al Raduno\. Ultima riga: 03\/11\/2026\.$/)).toBeVisible()
  const elenco = page.locator('details', { hasText: 'Iscrizioni al Raduno: 40' })
  await expect(elenco).not.toHaveAttribute('open')
  await expect(elenco.getByText(/^Chi si iscrive al Raduno paga con un bonifico a parte/)).toBeHidden()
  // Il campo per incollare sta sopra l'elenco, non quattro schermate più in basso.
  const campo = await page.locator('#banca').boundingBox()
  const sommario = await elenco.locator('summary').boundingBox()
  expect(campo && sommario && campo.y < sommario.y).toBe(true)
  await elenco.locator('summary').click()
  // La nota dice anche come si recupera una quota messa qui per errore: col riferimento o con la causale.
  await expect(elenco.getByText(/^Chi si iscrive al Raduno paga con un bonifico a parte/)).toBeVisible()
  await expect(elenco.getByText(/^Chi si iscrive al Raduno/)).toContainText(
    '«Registra un pagamento» e lo stesso riferimento',
  )
  await expect(elenco.getByText(/^Chi si iscrive al Raduno/)).toContainText('correggi la causale')
  await expect(elenco.locator('.riga')).toHaveCount(40)
  await fatto(page)
})

test('le pagine vuote lo dicono: niente da abbinare, niente da controllare, nessuno in attesa', async ({ page }) => {
  const sheets = demoSociSheets()
  // Via le righe della banca di «quota Rossi» e «quota Verdi» e il pagamento senza socio; l'attesa confermata.
  sheets[SOCI_SHEETS.bank.name]?.splice(3, 2)
  const pagamenti = sheets[SOCI_SHEETS.payments.name] ?? []
  pagamenti.splice(
    pagamenti.findIndex((riga) => riga[0] === 'P-2026-0015'),
    1,
  )
  const stato = SOCI_SHEETS.payments.columns.indexOf('stato')
  for (const riga of pagamenti.slice(1)) if (riga[0] === 'P-2026-0007') riga[stato] = 'registrato'
  // Il tesoriere sul suo account: con quello condiviso «Da controllare» lo direbbe.
  for (const riga of (sheets[SOCI_SHEETS.access.name] ?? []).slice(1))
    if (riga[0] === DEMO_OFFICE.treasurer) riga[1] = 'tesoriere@example.org'
  const contenuti = demoSheets(ADESSO)
  const chiSegue = SHEETS.deadlines.columns.indexOf('chi segue (ruolo)')
  for (const riga of (contenuti[SHEETS.deadlines.name] ?? []).slice(1))
    if (riga[0] === 'SCA-0003') riga[chiSegue] = 'il segretario'
  await apri(page, motoreVero({ sheets, contenuti }))
  await page.locator('.sezioni button').nth(1).click()
  await expect(page.getByText('Niente da abbinare: banca e registro tornano.')).toBeVisible()
  await expect(page.getByText('Nessun pagamento in attesa del tesoriere.')).toBeVisible()
  await fatto(page)
  await page.locator('.sezioni button').nth(2).click()
  await expect(sezione(page, 'Da controllare').first()).toHaveText('Niente da controllare.')
})

test('con KV irraggiungibile la registrazione resta, e «Oggi» lo dice finché non riesce', async ({ page }) => {
  const motore = motoreVero({ kvGiu: true })
  await apri(page, motore)
  await compila(page, { cerca: 'bellini', scegli: 'Marco Bellini · numero 2' }, { riferimento: '8842' })
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  await tasto(page, 'Torna ai soci').click()
  await page.locator('.sezioni button').nth(2).click()
  await expect(page.locator('main > .stato.bad')).toHaveText(
    /^I numeri dei soci non arrivano alla Riservata dal 05\/11\/2026: riprovo a ogni giro\. KV ha risposto 503/,
  )
  motore.kv.down = false
  await page.locator('.sezioni button').first().click()
  await socio(page, 'Marco Bellini').click()
  await page.locator('article', { hasText: 'P-2026-0016' }).getByRole('button', { name: "Cambia l'anno" }).click()
  await page.getByLabel("Vale per l'anno").selectOption('2027')
  await page.getByLabel('Motivo (obbligatorio)').fill('quota dell’anno dopo')
  await tasto(page, "Cambia l'anno").click()
  await expect(page.getByText('Ora il pagamento P-2026-0016 vale per il 2027.')).toBeVisible()
  await tasto(page, '‹ Indietro').click()
  await page.locator('.sezioni button').nth(2).click()
  await expect(titolo(page)).toHaveText('Oggi')
  await expect(page.locator('main > .stato.bad')).toHaveCount(0)
})

test('la copia mensile del libro soci non riuscita si legge in «Oggi»', async ({ page }) => {
  const libro = {
    savedOn: '2026-10-01',
    url: 'https://docs.google.com/spreadsheets/d/x/edit',
    failedOn: '2026-11-01',
    error: 'Drive non risponde',
  }
  await apri(page, motoreVero({ libro, driveGiu: true }))
  await page.locator('.sezioni button').nth(2).click()
  await expect(page.getByText('Ultimo libro soci nel Drive: 01/10/2026.')).toBeVisible()
  await expect(page.locator('main > .stato.bad')).toHaveText(
    'La copia del 01/11/2026 non è riuscita: Drive non risponde. Riprova con «Salva nel Drive»; se non va, avvisa chi cura la Bussola.',
  )
  await tasto(page, 'Salva nel Drive').click()
  await expect(page.locator('#errore-generale')).toHaveText('Il libro soci non è stato salvato: Drive non risponde')
  await fatto(page)
})

test('l’errore del servizio: all’apertura «Riprova»; alla registrazione la stessa chiave non duplica', async ({
  page,
}) => {
  const motore = motoreVero()
  motore.guasta('officeOpen')
  const { argomenti } = await apri(page, motore)
  await expect(page.getByText('La segreteria non si è aperta: Google non ha risposto. Tocca «Riprova».')).toBeVisible()
  await expect(
    page.getByText('Se non si apre nemmeno al secondo tentativo, scrivi a chi cura la Bussola.', { exact: true }),
  ).toBeVisible()
  await fatto(page)
  await tasto(page, 'Riprova').click()
  await expect(titolo(page)).toHaveText('Soci')

  await compila(page, { cerca: 'bellini', scegli: 'Marco Bellini · numero 2' }, { riferimento: '4410' })
  // Il motore salva, poi la risposta si perde: la pagina non sa se è stato salvato.
  motore.guasta('officeRecordPayment', 'dopo')
  await tasto(page, 'Registra e manda la mail').click()
  await expect(
    page.getByText("Non siamo sicuri che sia stato salvato. Riprova: se c'era già, non si duplica."),
  ).toBeVisible()
  await tasto(page, 'Riprova').click()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  const [primo, secondo] = argomenti('officeRecordPayment') as [PaymentInput, PaymentInput]
  expect(secondo.requestKey).toBe(primo.requestKey)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  expect(motore.mails).toHaveLength(1)
})

test('dopo una risposta persa, dati cambiati sono un pagamento nuovo: chiave nuova, e il possibile doppione', async ({
  page,
}) => {
  const motore = motoreVero()
  const { argomenti } = await apri(page, motore)
  await compila(page, { cerca: 'bellini', scegli: 'Marco Bellini · numero 2' }, { riferimento: '4410' })
  motore.guasta('officeRecordPayment', 'dopo')
  await tasto(page, 'Registra e manda la mail').click()
  await expect(
    page.getByText("Non siamo sicuri che sia stato salvato. Riprova: se c'era già, non si duplica."),
  ).toBeVisible()
  // Con la stessa chiave il motore direbbe «già entrata con altri dati»: la pagina ne fa una nuova a ogni modifica.
  await tasto(page, 'Torna indietro').click()
  await page.getByLabel('Importo').fill('60')
  await tasto(page, 'Continua').click()
  await tasto(page, 'Registra e manda la mail').click()
  await expect(titolo(page)).toHaveText('Possibile doppione')
  const [primo, secondo] = argomenti('officeRecordPayment') as [PaymentInput, PaymentInput]
  expect(secondo).toMatchObject({ memberNumber: '2', amount: '60' })
  expect(secondo.requestKey).toMatch(/^[0-9a-f]{32}$/)
  expect(secondo.requestKey).not.toBe(primo.requestKey)
  expect(motore.pagamenti()).toHaveLength(PAGAMENTI + 1)
  expect(motore.pagamento('P-2026-0016')).toMatchObject({ importo: 30 })
  expect(motore.mails).toHaveLength(1)
})

test('un problema del Foglio all’apertura si legge in italiano, con «Riprova»', async ({ page }) => {
  const sheets = sociInventati(0)
  delete sheets['Soci']
  await apri(page, motoreVero({ sheets }))
  await expect(page.locator('main .stato.bad')).toContainText('Soci')
  await expect(tasto(page, 'Riprova')).toBeVisible()
  await expect(
    page.getByText('Se non si apre nemmeno al secondo tentativo, scrivi a chi cura la Bussola.'),
  ).toBeVisible()
})

test('con 300 soci la ricerca resta immediata', async ({ page }) => {
  await apri(page, motoreVero({ sheets: sociInventati(300) }))
  await expect(sociVisibili(page)).toHaveCount(300)
  const millisecondi = await page.evaluate(() => {
    const cerca = document.querySelector<HTMLInputElement>('#cerca')
    if (!cerca) return Infinity
    const inizio = performance.now()
    for (const testo of ['c', 'co', 'cognome2', 'cognome29', 'cognome299']) {
      cerca.value = testo
      cerca.dispatchEvent(new Event('input'))
    }
    return performance.now() - inizio
  })
  await expect(sociVisibili(page)).toHaveCount(1)
  // Cinque tasti premuti in fila: ben sotto un fotogramma ciascuno.
  expect(millisecondi).toBeLessThan(100)
})
