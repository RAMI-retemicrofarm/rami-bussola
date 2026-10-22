import { expect, test, type Page } from '@playwright/test'
import { DEMO_EMAILS } from '../../motore/src/demo.ts'
import { DEMO_INSTRUCTIONS_URL, DEMO_OFFICE, DEMO_SOCI_COUNTS } from '../../motore/src/demo-soci.ts'
import type { OfficeCall, PaymentInput } from '../../motore/src/office-api.ts'
import { expectDefinitionOfDone } from './fatto.ts'
import { apriSegreteria, type Rispondi } from './segreteria-finta.ts'
import { ACCOUNT, giorno, motoreVero, sociInventati, type MotoreVero } from './segreteria-motore.ts'

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
  await expect(page.locator('.sezioni')).toHaveCount(0)
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
  await expect(page.locator('.sezioni')).toHaveCount(0)
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
      'Questo pagamento sembra già registrato: Nicola Testa, 30 €, rif. 0013, registrato dal tesoriere il 15/03. Non lo registro due volte.',
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
  // 5501 è il bonifico di 60 € di Giulia e Tommaso Neri.
  await compila(page, { cerca: 'bellini', scegli: 'Marco Bellini · numero 2' }, { riferimento: '5501' })
  await tasto(page, 'Registra e manda la mail').click()
  await expect(page.getByText('Registrato. Marco Bellini è in regola per il 2026.')).toBeVisible()
  expect(motore.pagamenti().filter((riga) => riga.riferimento === '5501')).toHaveLength(3)
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
  // Da Soci si vede già che c'è da guardare: parola e triangolo, non solo il colore.
  const oggi = page.locator('.sezioni button').nth(1)
  await expect(oggi).toHaveText('Oggi · 1 da guardare')
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
  await expect(page.locator('.stato.bad')).toHaveText("Fuori dall'elenco, può modificare")
  await expect(
    page.getByText("Togli l'accesso dal Foglio soci, oppure aggiungi la persona in «Accessi».", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Ultimo controllo: 05/11/2026.')).toBeVisible()
  await expect(page.getByText('Il resto di «Oggi» arriva con la prossima versione.')).toHaveCount(0)
  await expect(page.getByText('Il controllo delle condivisioni', { exact: false })).toHaveCount(0)
  await fatto(page)

  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-05', findings: [] } })
  await page.reload()
  await expect(oggi).toHaveText('Oggi')
  await oggi.click()
  await expect(page.getByText("Nessuna condivisione fuori dall'elenco. Ultimo controllo: 05/11/2026.")).toBeVisible()

  // Due giorni senza controllo vanno ancora; dal terzo, l'avviso.
  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-03', findings: [] } })
  await page.reload()
  await oggi.click()
  await expect(page.getByText("Nessuna condivisione fuori dall'elenco. Ultimo controllo: 03/11/2026.")).toBeVisible()
  await expect(page.locator('main .stato.warn')).toHaveCount(0)
  motore = motoreVero({ condivisioni: { checkedOn: '2026-11-02', findings: [] } })
  await page.reload()
  await oggi.click()
  await expect(page.locator('main .stato.warn')).toHaveText(
    'Il controllo delle condivisioni non gira dal 02/11/2026: avvisa chi cura la Bussola.',
  )
  await fatto(page)

  motore = motoreVero()
  await page.reload()
  await oggi.click()
  await expect(page.locator('main .stato.warn')).toHaveText(
    'Il controllo delle condivisioni non ha ancora girato: avvisa chi cura la Bussola.',
  )
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
