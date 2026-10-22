// Su `rami-bussola.pages.dev` e sulle anteprime ogni richiesta vuole il JWT di Access (ADR 0001). Access ferma chi
// non è nell'elenco, e la Function lo ricontrolla: un errore nella configurazione di Access non apre i dati. Il JWT si
// rifiuta in sei casi (T1): manca, è scaduto (o non ha scadenza), `aud` o `iss` sbagliati, firma alterata, `alg` none.
// In locale Access non c'è: il controllo si salta, e chi entra lo dice la mail di prova delle E2E.
import type { MiddlewareHandler } from 'hono'
import { verifyWithJwks } from 'hono/jwt'
import type { BussolaEnv } from './env.ts'
import { LOCAL_HOSTS } from './security.ts'

/** Solo in locale: la mail di chi entra, per provare le pagine come rappresentante o come Direttivo. */
export const LOCAL_EMAIL_HEADER = 'X-Bussola-Prova-Mail'

export const accessGuard: MiddlewareHandler<BussolaEnv> = async (c, next) => {
  if (LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
    c.set('accessEmail', c.req.header(LOCAL_EMAIL_HEADER) ?? '')
    return next()
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion')
  const team = c.env.ACCESS_TEAM_DOMAIN
  const aud = c.env.ACCESS_AUD
  if (!token || !team || !aud) return c.text('Accesso negato.', 403)
  try {
    const payload = await verifyWithJwks(token, {
      jwks_uri: `https://${team}/cdn-cgi/access/certs`,
      allowedAlgorithms: ['RS256'],
      verification: { iss: `https://${team}`, aud },
    })
    // Hono controlla `exp` solo se c'è: un JWT di Access ce l'ha sempre.
    if (typeof payload.exp !== 'number') return c.text('Accesso negato.', 403)
    c.set('accessEmail', typeof payload.email === 'string' ? payload.email : '')
  } catch {
    return c.text('Accesso negato.', 403)
  }
  return next()
}
