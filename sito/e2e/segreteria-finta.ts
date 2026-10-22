// La pagina della segreteria in un browser vero, con un `google.script.run` finto: ogni chiamata della pagina arriva a
// `rispondi(nome, argomento)`, in Node. Dietro c'è il motore vero (segreteria-motore.ts), su un Foglio inventato.
import type { Page } from '@playwright/test'
import { OFFICE_CALLS, type OfficeCall } from '../../motore/src/office-api.ts'
import { officePageHtml } from '../../motore/src/office-page.ts'

/** L'indirizzo finto: con `setContent` la pagina starebbe su about:blank, dove `localStorage` non va. */
export const SEGRETERIA = 'https://segreteria.test/'

export type Rispondi = (nome: OfficeCall, argomento: unknown) => unknown
export type Chiamata = { nome: OfficeCall; argomento: unknown }

/**
 * Serve la pagina come la serve HtmlService, con la riga viewport che aggiunge il motore, e la apre. Ogni altra
 * richiesta si ferma e finisce in `esterne`: la pagina non deve caricare niente da fuori. Se `rispondi` lancia un
 * errore, alla pagina arriva il suo failure handler, come quando Apps Script non risponde.
 */
export async function apriSegreteria(page: Page, rispondi: Rispondi) {
  const chiamate: Chiamata[] = []
  const esterne: string[] = []
  const html = officePageHtml().replace(
    '<head>',
    '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  )
  await page.route('**/*', (route) => {
    if (route.request().url() === SEGRETERIA)
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    esterne.push(route.request().url())
    return route.abort()
  })
  await page.exposeFunction('__bussolaRispondi', async (nome: OfficeCall, argomento: unknown) => {
    chiamate.push({ nome, argomento })
    try {
      return { ok: await rispondi(nome, argomento) }
    } catch (error) {
      return { errore: error instanceof Error ? error.message : String(error) }
    }
  })
  await page.addInitScript(
    (calls: string[]) => {
      type Handlers = { ok?: (result: unknown) => void; fail?: (error: Error) => void }
      type Answer = { ok?: unknown; errore?: string }
      const w = window as unknown as {
        google: unknown
        __bussolaRispondi: (nome: string, argomento: unknown) => Promise<Answer>
      }
      // Come `google.script.run`: ogni `with…Handler` dà un nuovo runner, e la chiamata non restituisce niente.
      const runner = (handlers: Handlers): Record<string, unknown> => {
        const run: Record<string, unknown> = {
          withSuccessHandler: (ok: Handlers['ok']) => runner({ ...handlers, ok }),
          withFailureHandler: (fail: Handlers['fail']) => runner({ ...handlers, fail }),
        }
        for (const name of calls)
          run[name] = (argomento: unknown) => {
            void w.__bussolaRispondi(name, argomento).then((answer) => {
              if (answer.errore !== undefined) handlers.fail?.(new Error(answer.errore))
              else handlers.ok?.(answer.ok)
            })
          }
        return run
      }
      w.google = { script: { run: runner({}) } }
    },
    [...OFFICE_CALLS],
  )
  await page.goto(SEGRETERIA)
  return { chiamate, esterne }
}
