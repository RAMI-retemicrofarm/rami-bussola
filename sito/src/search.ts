// La ricerca di /cerca, sul server: fra i GdL, i cantieri e i link. Senza accenti e senza maiuscole, ogni parola
// cercata deve esserci; prima vengono quelli con le parole nel titolo.
import type { ReservedProject, SiteGroup, SiteLink } from '@bussola/condiviso'

/** Le ricerche più lunghe si tagliano: nessuno cerca cento caratteri. */
export const MAX_QUERY = 100

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it')

const wordsOf = (query: string) =>
  fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

export type SearchResults = { groups: SiteGroup[]; projects: ReservedProject[]; links: SiteLink[] }

export function search(
  query: string,
  data: { groups: readonly SiteGroup[]; projects: readonly ReservedProject[]; links: readonly SiteLink[] },
  groupName: (id: string) => string = (id) => id,
): SearchResults {
  const words = wordsOf(query.slice(0, MAX_QUERY))
  const find = <T>(items: readonly T[], title: (item: T) => string, rest: (item: T) => string) => {
    if (!words.length) return []
    const scored = items
      .map((item) => {
        const head = fold(title(item))
        const all = `${head} ${fold(rest(item))}`
        return { item, inTitle: words.every((word) => head.includes(word)), found: words.every((w) => all.includes(w)) }
      })
      .filter(({ found }) => found)
    return [...scored.filter(({ inTitle }) => inTitle), ...scored.filter(({ inTitle }) => !inTitle)].map(
      ({ item }) => item,
    )
  }
  return {
    groups: find(
      data.groups,
      (group) => group.name,
      (group) => group.mission,
    ),
    projects: find(
      data.projects,
      (project) => project.title,
      (project) => `${groupName(project.groupId)} ${project.nextStep} ${project.lastNews}`,
    ),
    links: find(
      data.links,
      (link) => link.title,
      () => '',
    ),
  }
}
