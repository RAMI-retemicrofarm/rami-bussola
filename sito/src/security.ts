// Le intestazioni di sicurezza della vetrina (cartamodello, «Sicurezza»): niente cornici, niente indici, niente
// sul telefono per le pagine riservate, solo HTTPS, niente camera, microfono e posizione. Valgono per ogni risposta,
// anche per i rifiuti e i rimandi.
import type { Context, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'

export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
  },
  strictTransportSecurity: 'max-age=31536000',
  referrerPolicy: 'no-referrer',
  xFrameOptions: 'DENY',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
})

export const noIndex: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('X-Robots-Tag', 'noindex')
}

/** Per le pagine con i dati della Riservata: il telefono non le tiene. */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
}

export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

/** Il sito della Riservata, dietro Access; il dominio dei soci risponde senza Access. */
export const RESERVED_ORIGIN = 'https://rami-bussola.pages.dev'
export const MEMBERS_HOST = 'bussola.retemicrofarm.it'

/** Gli host di chi prova in locale: solo lì contano le intestazioni di prova delle E2E (qui e in access.ts). */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Solo in locale: l'host per cui passare, per provare il dominio dei soci nelle E2E. */
export const LOCAL_HOST_HEADER = 'X-Bussola-Prova-Host'

/** L'host della richiesta; in locale, quello dell'intestazione di prova, se c'è. */
export function requestHost(c: Context): string {
  const host = new URL(c.req.url).hostname
  if (!LOCAL_HOSTS.has(host)) return host
  return c.req.header(LOCAL_HOST_HEADER)?.trim().toLowerCase() || host
}

export const onMembersHost = (c: Context) => requestHost(c) === MEMBERS_HOST

/** Sul dominio dei soci la Riservata non c'è: si rimanda a pages.dev, dietro Access. */
export const reservedOnPagesDev: MiddlewareHandler = async (c, next) => {
  if (!onMembersHost(c)) return next()
  const url = new URL(c.req.url)
  return c.redirect(`${RESERVED_ORIGIN}${url.pathname}${url.search}`, 302)
}
