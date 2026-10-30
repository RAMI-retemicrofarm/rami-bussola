// /link: i link dell'associazione, ognuno con chi lo può aprire. Per quelli dei soli partecipanti di un GdL o del
// Coordinamento la pagina dice anche a chi chiedere l'accesso: ai referenti del gruppo, o alla segreteria. L'indirizzo
// c'è solo per i link che la persona può aprire: degli altri l'HTML ha il titolo, non l'URL.
import type { ReservedPerson, SiteGroup, SiteLink, SiteSnapshot } from '@bussola/condiviso'
import { repGroupId } from './identity.ts'

/**
 * Il nome del GdL di un link, per /link e per /cerca. Se il Foglio dei gruppi non ha quel gruppo (un refuso), resta
 * l'id: meglio «del GdL GDL-ortti» che una frase monca.
 */
export function linkGroupName(link: SiteLink, groups: readonly SiteGroup[]): string {
  const group = link.groupId ? groups.find((candidate) => candidate.id === link.groupId) : undefined
  return group?.name ?? link.groupId ?? ''
}

/** Chi lo può aprire, a parole. */
export function audienceLabel(link: SiteLink, groupName: string): string {
  switch (link.audience) {
    case 'all':
      return 'Lo apre chiunque.'
    case 'members':
      return 'Lo aprono i soci.'
    case 'group':
      return `Lo aprono solo i partecipanti del GdL ${groupName}.`
    case 'coordination':
      return 'Lo apre solo il Coordinamento.'
  }
}

/** I link che la persona può aprire: quelli di tutti e dei soci, quelli del suo GdL e, per il Coordinamento, i suoi. */
export function linksFor(links: readonly SiteLink[], person: ReservedPerson | null): SiteLink[] {
  const group = repGroupId(person)
  const coordination = person?.roles.some((role) => role === 'board' || role === 'rep') ?? false
  return links.filter(
    (link) =>
      link.audience === 'all' ||
      link.audience === 'members' ||
      (link.audience === 'group' && link.groupId === group) ||
      (link.audience === 'coordination' && coordination),
  )
}

function LinkRow({ link, site, canOpen }: { link: SiteLink; site: SiteSnapshot; canOpen: boolean }) {
  const groupName = linkGroupName(link, site.groups)
  return (
    <article class="riga">
      <div>
        {canOpen ? (
          <a class="voce" href={link.url}>
            {link.title}
          </a>
        ) : (
          <span class="voce">{link.title}</span>
        )}
        <p class="small">{audienceLabel(link, groupName)}</p>
        {link.audience === 'group' && (
          <>
            <p class="small">Per entrare, chiedi ai referenti del gruppo.</p>
            <a class="btn sec mini" href={`/gruppi/${encodeURIComponent(link.groupId ?? '')}`}>
              Chi segue {groupName}
            </a>
          </>
        )}
        {link.audience === 'coordination' && (
          <>
            <p class="small">Per entrare, chiedi alla segreteria.</p>
            {site.officeUrl && (
              <a class="btn sec mini" href={site.officeUrl}>
                Scrivi alla segreteria<span class="vh">: {link.title}</span>
              </a>
            )}
          </>
        )}
      </div>
    </article>
  )
}

export function LinkPage({ site, person }: { site: SiteSnapshot | null; person: ReservedPerson | null }) {
  const mine = new Set(site ? linksFor(site.links, person) : [])
  return (
    <>
      <h1>Link</h1>
      <p class="sub">Chat, cartelle, moduli e calendari, con chi li può aprire.</p>
      {!site ? (
        <p role="status">I link non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.</p>
      ) : site.links.length === 0 ? (
        <p role="status">Non ci sono ancora link.</p>
      ) : (
        <div class="card">
          {site.links.map((link) => (
            <LinkRow link={link} site={site} canOpen={mine.has(link)} />
          ))}
        </div>
      )}
    </>
  )
}
