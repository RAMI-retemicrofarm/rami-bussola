import { jsxRenderer } from 'hono/jsx-renderer'
import type { BussolaEnv } from './env.ts'
import { canEnter } from './identity.ts'

export type Section = 'home' | 'cantieri' | 'gruppi' | 'riservata'

declare module 'hono' {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      /** `bare`: senza la barra, per chi non può entrare. */
      props?: { title?: string; section?: Section; bare?: boolean },
    ): Response | Promise<Response>
  }
}

const icon = {
  stroke: 'currentColor',
  fill: 'none',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}

const HomeIcon = () => (
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" {...icon}>
    <path d="M4 11l8-7 8 7" />
    <path d="M6 9.5V20h12V9.5" />
    <path d="M10 20v-5h4v5" />
  </svg>
)

const GroupsIcon = () => (
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" {...icon}>
    <circle cx="9" cy="8" r="3" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M15 14.5c.6-.3 1.3-.5 2-.5 2.8 0 5 2.2 5 5" />
  </svg>
)

const CantieriIcon = () => (
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" {...icon}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9l2 2 4-4" />
    <path d="M8 15h8" />
  </svg>
)

const LockIcon = () => (
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" {...icon}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

/**
 * La barra ha solo voci che portano a pagine che esistono: Home, Cantieri, Gruppi; «Riservata» solo per chi ha un
 * ruolo. Io e Impegni arrivano con le loro pagine.
 */
function Bar({ section, reserved }: { section?: Section; reserved: boolean }) {
  const item = (href: string, name: Section, label: string, Icon: typeof LockIcon) => (
    <a href={href} class={section === name ? 'on' : undefined} aria-current={section === name ? 'page' : undefined}>
      <Icon />
      {label}
    </a>
  )
  return (
    <nav class="barra" aria-label="Sezioni">
      {item('/', 'home', 'Home', HomeIcon)}
      {item('/cantieri', 'cantieri', 'Cantieri', CantieriIcon)}
      {item('/gruppi', 'gruppi', 'Gruppi', GroupsIcon)}
      {reserved && item('/riservata', 'riservata', 'Riservata', LockIcon)}
    </nav>
  )
}

export const renderer = jsxRenderer<BussolaEnv>(({ children, title, section, bare }, c) => {
  const reserved = canEnter(c.get('person'))
  return (
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{title ? `${title} · Bussola` : 'Bussola · RAMI'}</title>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body>
        {/* La fascia della Riservata sta nell'header, a tutta larghezza: chi si muove fra i landmark la incontra. */}
        <header>
          <div class="testata">
            <p class="marchio">
              Bussola <span class="small">· RAMI</span>
            </p>
          </div>
          {section === 'riservata' && (
            <p class="stanza">
              <LockIcon />
              Solo Direttivo, Coordinamento e segreteria
            </p>
          )}
        </header>
        <main id="contenuto">{children}</main>
        {!bare && <Bar section={section} reserved={reserved} />}
      </body>
    </html>
  )
})
