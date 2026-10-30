import { romeDate, romeDateTime, usageArea } from '@bussola/condiviso'
import { Hono, type Context } from 'hono'
import { accessGuard } from './access.ts'
import { CantieriPage, projectFilter } from './cantieri.tsx'
import { SearchPage } from './cerca.tsx'
import type { BussolaEnv } from './env.ts'
import { GroupPage, GroupsPage } from './gruppi.tsx'
import { HomePage } from './home.tsx'
import { CommitmentPage } from './impegni.tsx'
import { canEnter, findPerson, loadMembers, loadReserved, loadSite } from './identity.ts'
import { LinkPage } from './link.tsx'
import { FirstDayPage } from './primo-giorno.tsx'
import { PrivacyPage, SoonPage } from './privacy.tsx'
import { renderer } from './renderer.tsx'
import { RiservataPage } from './riservata.tsx'
import { count } from './usage.ts'
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

// La misura dell'uso (O5): su pages.dev contano Direttivo e rappresentanti, una volta al mese. Non ferma mai la
// pagina: se KV non risponde, quella visita non si conta.
app.use(async (c, next) => {
  const person = c.get('person')
  const area = c.req.method === 'GET' ? usageArea(person, 'riservata') : null
  if (person && area) {
    const counting = count(
      { memberNumber: person.memberNumber, email: c.get('accessEmail') },
      area,
      new Date(),
      c.env.BUSSOLA,
    ).catch(() => null)
    // Su Pages dopo la risposta; nelle prove, che non hanno il contesto di Workers, prima.
    try {
      c.executionCtx.waitUntil(counting)
    } catch {
      await counting
    }
  }
  return next()
})

/** Le date di oggi, a Roma: il giorno per le scadenze, giorno e ora per gli incontri. */
const now = () => {
  const instant = new Date()
  return { today: romeDate(instant), now: romeDateTime(instant) }
}

app.get('/', noStore, async (c) =>
  c.render(
    <HomePage site={await loadSite(c.env.BUSSOLA)} reserved={c.get('reserved')} person={c.get('person')} {...now()} />,
    { section: 'home' },
  ),
)

app.get('/cantieri', noStore, (c) =>
  c.render(
    <CantieriPage
      snapshot={c.get('reserved')}
      person={c.get('person')}
      today={romeDate(new Date())}
      filter={projectFilter(c.req.query('filtro'))}
    />,
    { title: 'Cantieri', section: 'cantieri' },
  ),
)

app.get('/gruppi', noStore, async (c) =>
  c.render(<GroupsPage site={await loadSite(c.env.BUSSOLA)} {...now()} />, { title: 'Gruppi', section: 'gruppi' }),
)

app.get('/gruppi/:id', noStore, async (c) => {
  const site = await loadSite(c.env.BUSSOLA)
  const group = site?.groups.find((candidate) => candidate.id === c.req.param('id'))
  if (!site || !group) {
    c.status(404)
    return c.render(
      <>
        <h1>Gruppo non trovato</h1>
        <p>{site ? 'Questo gruppo non c’è, o ha cambiato nome.' : 'I gruppi non sono ancora arrivati dal Foglio.'}</p>
        <a class="btn sec" href="/gruppi">
          Guarda i Gruppi
        </a>
      </>,
      { title: 'Gruppo non trovato', section: 'gruppi' },
    )
  }
  return c.render(
    <GroupPage group={group} site={site} reserved={c.get('reserved')} person={c.get('person')} {...now()} />,
    { title: group.name, section: 'gruppi' },
  )
})

app.get('/link', noStore, async (c) =>
  c.render(<LinkPage site={await loadSite(c.env.BUSSOLA)} person={c.get('person')} />, { title: 'Link' }),
)

app.get('/primo-giorno', noStore, async (c) =>
  c.render(<FirstDayPage site={await loadSite(c.env.BUSSOLA)} />, { title: 'Il primo giorno' }),
)

app.get('/cerca', noStore, async (c) =>
  c.render(
    <SearchPage
      query={c.req.query('q') ?? ''}
      site={await loadSite(c.env.BUSSOLA)}
      reserved={c.get('reserved')}
      person={c.get('person')}
    />,
    { title: 'Cerca' },
  ),
)

app.get('/riservata', noStore, async (c) =>
  c.render(
    <RiservataPage
      snapshot={c.get('reserved')}
      members={await loadMembers(c.env.BUSSOLA)}
      today={romeDate(new Date())}
    />,
    { title: 'Riservata', section: 'riservata' },
  ),
)

// La scheda di un impegno in sette blocchi (T6), dietro Access e il controllo delle Persone della Riservata.
app.get('/riservata/impegni/:id', noStore, (c) => {
  const snapshot = c.get('reserved')
  const commitment = snapshot?.commitments.find((candidate) => candidate.id === c.req.param('id'))
  if (!snapshot || !commitment) {
    c.status(404)
    return c.render(
      <>
        <h1>Impegno non trovato</h1>
        <p>
          {snapshot
            ? 'Questo impegno non c’è, o non è di quest’anno.'
            : 'I dati della Riservata non sono ancora arrivati.'}
        </p>
        <a class="btn sec" href="/riservata">
          Torna alla Riservata
        </a>
      </>,
      { title: 'Impegno non trovato', section: 'riservata' },
    )
  }
  return c.render(<CommitmentPage commitment={commitment} snapshot={snapshot} today={romeDate(new Date())} />, {
    title: commitment.title,
    section: 'riservata',
  })
})

// Su pages.dev l'informativa sta dietro Access come il resto (ADR 0001), con la barra.
app.get('/privacy', (c) => privacy(c))

export default app
