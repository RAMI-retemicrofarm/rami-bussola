import { jsxRenderer } from 'hono/jsx-renderer'
import type { BussolaEnv } from './env.ts'
import { canEnter } from './identity.ts'

export type Section = 'cantieri' | 'riservata'

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

/** La barra ha solo voci che portano a pagine che esistono; «Riservata» solo per chi ha un ruolo. */
function Bar({ section, reserved }: { section?: Section; reserved: boolean }) {
  const item = (href: string, name: Section, label: string, Icon: typeof LockIcon) => (
    <a href={href} class={section === name ? 'on' : undefined} aria-current={section === name ? 'page' : undefined}>
      <Icon />
      {label}
    </a>
  )
  return (
    <nav class="barra" aria-label="Sezioni">
      {item('/cantieri', 'cantieri', 'Cantieri', CantieriIcon)}
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
        <header class="testata">
          <p class="marchio">
            Bussola <span class="small">· RAMI</span>
          </p>
        </header>
        {section === 'riservata' && (
          <p class="stanza">
            <LockIcon />
            Solo Direttivo, Coordinamento e segreteria
          </p>
        )}
        <main id="contenuto">{children}</main>
        {!bare && <Bar section={section} reserved={reserved} />}
      </body>
    </html>
  )
})
