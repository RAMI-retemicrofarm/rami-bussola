import { HELLO_KEY, parseHello, romeDate, type Hello } from '@bussola/condiviso'
import { Hono, type Context } from 'hono'
import { accessGuard } from './access.ts'
import { CantieriPage } from './cantieri.tsx'
import type { BussolaEnv } from './env.ts'
import { canEnter, findPerson, loadReserved } from './identity.ts'
import { PrivacyPage, SoonPage } from './privacy.tsx'
import { renderer } from './renderer.tsx'
import { RiservataPage } from './riservata.tsx'
import { noIndex, noStore, onMembersHost, reservedOnPagesDev, ROBOTS_TXT, securityHeaders } from './security.ts'

const app = new Hono<BussolaEnv>()

// L'ordine conta: le intestazioni valgono per ogni risposta; robots.txt e il dominio dei soci vengono prima di Access.
app.use(securityHeaders, noIndex, renderer)
app.get('/robots.txt', (c) => c.text(ROBOTS_TXT))
app.use('/riservata', reservedOnPagesDev)
app.use('/riservata/*', reservedOnPagesDev)

// L'informativa è uguale per tutti e cambia di rado: una cache breve basta perché una correzione arrivi presto.
const privacy = (c: Context<BussolaEnv>, bare = false) => {
  c.header('Cache-Control', 'public, max-age=300')
  return c.render(<PrivacyPage />, { title: 'Come usiamo i dati', bare })
}

// Il dominio dei soci sta senza Access: risponde solo con l'informativa e con la pagina «apre a gennaio», senza
// leggere il KV. Quella pagina non si tiene in cache, perché a gennaio lascia il posto all'entrata dei soci.
app.use(async (c, next) => {
  if (!onMembersHost(c)) return next()
  if (c.req.path === '/privacy') return privacy(c, true)
  c.header('Cache-Control', 'no-store')
  return c.render(<SoonPage />, { title: 'Apre a gennaio', bare: true })
})

app.use(accessGuard)
app.use(async (c, next) => {
  const reserved = await loadReserved(c.env.BUSSOLA)
  c.set('reserved', reserved)
  c.set('person', await findPerson(c.get('accessEmail'), reserved))
  return next()
})
// Access ferma chi non è nella sua lista, che chi cura la Bussola tiene a mano da «Persone della Riservata». La
// Function ricontrolla sul Foglio: chi ne esce non vede più i dati, anche se è rimasto nella lista di Access. Senza
// istantanea non c'è niente da proteggere, e le pagine lo dicono a parole.
app.use(async (c, next) => {
  if (!c.get('reserved') || canEnter(c.get('person'))) return next()
  c.status(403)
  c.header('Cache-Control', 'no-store')
  return c.render(
    <>
      <h1>Non puoi entrare</h1>
      <p>Questa parte della Bussola è per Direttivo, Coordinamento e segreteria.</p>
      <p>Se ne fai parte, chiedi a chi cura la Bussola di aggiungere la tua mail alle Persone della Riservata.</p>
    </>,
    { title: 'Non puoi entrare', bare: true },
  )
})

const writtenAt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' })

function HelloCard({ hello }: { hello: Hello | null }) {
  if (!hello) return <p role="status">Il motore non ha ancora scritto niente.</p>
  return (
    <section class="scheda">
      <p>
        Il motore dice: <strong>«{hello.message}»</strong>
      </p>
      <p class="piccolo">Scritto il {writtenAt.format(new Date(hello.writtenAt))}.</p>
    </section>
  )
}

// La prova dell'imbastitura: la pagina legge da KV il valore che il motore ha scritto in Google. Resta finché la
// Home arriva in T7, perché serve a provare gli account di RAMI (docs/sviluppo.md).
app.get('/', async (c) => {
  const hello = parseHello(await c.env.BUSSOLA.get(HELLO_KEY, 'json'))
  return c.render(
    <>
      <h1>Ciao dalla Bussola</h1>
      <HelloCard hello={hello} />
    </>,
  )
})

app.get('/cantieri', noStore, (c) =>
  c.render(<CantieriPage snapshot={c.get('reserved')} person={c.get('person')} today={romeDate(new Date())} />, {
    title: 'Cantieri',
    section: 'cantieri',
  }),
)

app.get('/riservata', noStore, (c) =>
  c.render(<RiservataPage snapshot={c.get('reserved')} today={romeDate(new Date())} />, {
    title: 'Riservata',
    section: 'riservata',
  }),
)

// Su pages.dev l'informativa sta dietro Access come il resto (ADR 0001), con la barra.
app.get('/privacy', (c) => privacy(c))

export default app
