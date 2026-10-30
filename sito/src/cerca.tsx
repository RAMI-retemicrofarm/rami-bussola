// /cerca?q=: la ricerca sul server, fra GdL, cantieri e link. Un modulo GET, senza JavaScript: il risultato è una
// pagina come le altre. Dei link che la persona non può aprire si vede il titolo con chi lo apre, non l'indirizzo.
import type { ReservedPerson, ReservedSnapshot, SiteSnapshot } from '@bussola/condiviso'
import { audienceLabel, linkGroupName, linksFor } from './link.tsx'
import { MAX_QUERY, search } from './search.ts'

export function SearchForm({ query = '' }: { query?: string }) {
  return (
    <form class="cerca" action="/cerca" method="get" role="search">
      <label for="q">Cerca fra gruppi, cantieri e link</label>
      <div class="cerca-riga">
        <input id="q" name="q" type="search" value={query} maxlength={MAX_QUERY} autocomplete="off" />
        <button type="submit" class="btn mini">
          Cerca
        </button>
      </div>
    </form>
  )
}

export function SearchPage(props: {
  query: string
  site: SiteSnapshot | null
  reserved: ReservedSnapshot | null
  person: ReservedPerson | null
}) {
  const query = props.query.trim().slice(0, MAX_QUERY)
  const groupNames = new Map(props.site?.groups.map((group) => [group.id, group.name]))
  const mine = new Set(props.site ? linksFor(props.site.links, props.person) : [])
  const results = search(
    query,
    { groups: props.site?.groups ?? [], projects: props.reserved?.projects ?? [], links: props.site?.links ?? [] },
    (id) => groupNames.get(id) ?? id,
  )
  const total = results.groups.length + results.projects.length + results.links.length
  return (
    <>
      <h1>Cerca</h1>
      <SearchForm query={query} />
      {query &&
        (total === 0 ? (
          <>
            <p role="status">Nessun risultato per «{query}». Prova con un'altra parola, o guarda i Gruppi.</p>
            <a class="btn sec" href="/gruppi">
              Guarda i Gruppi
            </a>
          </>
        ) : (
          <>
            <p role="status">
              {total === 1 ? '1 risultato' : `${total} risultati`} per «{query}».
            </p>
            {results.groups.length > 0 && (
              <section aria-labelledby="trovati-gruppi">
                <h2 id="trovati-gruppi">Gruppi</h2>
                <ul class="elenco card">
                  {results.groups.map((group) => (
                    <li>
                      <a class="voce" href={`/gruppi/${encodeURIComponent(group.id)}`}>
                        {group.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {results.projects.length > 0 && (
              <section aria-labelledby="trovati-cantieri">
                <h2 id="trovati-cantieri">Cantieri</h2>
                <ul class="elenco card">
                  {results.projects.map((project) => (
                    <li>
                      <a class="voce" href={`/cantieri#${encodeURIComponent(project.id)}`}>
                        {project.title}
                      </a>
                      <p class="small">GdL {groupNames.get(project.groupId) ?? project.groupId}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {results.links.length > 0 && (
              <section aria-labelledby="trovati-link">
                <h2 id="trovati-link">Link</h2>
                <ul class="elenco card">
                  {results.links.map((link) => (
                    <li>
                      {mine.has(link) ? (
                        <a class="voce" href={link.url}>
                          {link.title}
                        </a>
                      ) : (
                        <>
                          <span class="voce">{link.title}</span>
                          <p class="small">{audienceLabel(link, linkGroupName(link, props.site?.groups ?? []))}</p>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <a class="btn sec" href="/link">
                  Chi può aprire i link
                </a>
              </section>
            )}
          </>
        ))}
    </>
  )
}
