// /gruppi e /gruppi/<id>: cosa fa ogni GdL, chi lo segue, come si partecipa, dove e quando, il prossimo incontro e
// come contattarlo. I referenti col nome solo se hanno dato il consenso, gli altri col ruolo; mai mail né telefoni:
// il contatto è la chat del gruppo se è aperta ai soci, altrimenti la segreteria. Su pages.dev il rappresentante vede
// anche il prossimo incontro del suo gruppo non visibile ai soci, e i suoi tasti.
import {
  nextMeeting,
  type CalendarDate,
  type LocalDateTime,
  type Referent,
  type ReservedPerson,
  type ReservedSnapshot,
  type SiteGroup,
  type SiteSnapshot,
} from '@bussola/condiviso'
import { repGroupId } from './identity.ts'
import { formatMeeting, MeetingCard } from './ui.tsx'

/** Il messaggio quando l'istantanea del sito non c'è ancora. */
export const SITE_MISSING = 'I gruppi non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.'

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('it') + text.slice(1)

/** «Lia Prova, referente»; senza consenso solo «Referente». */
const referentLabel = (referent: Referent) =>
  referent.name ? `${referent.name}, ${referent.role}` : capitalize(referent.role)

/** Il prossimo incontro del gruppo: per il suo rappresentante anche quelli non visibili ai soci. */
function groupMeeting(
  groupId: string,
  site: SiteSnapshot,
  reserved: ReservedSnapshot | null,
  person: ReservedPerson | null,
  now: LocalDateTime,
) {
  if (reserved && repGroupId(person) === groupId) {
    const meeting = nextMeeting(reserved.meetings, now, groupId)
    if (meeting) return { meeting, internal: !meeting.membersCanSee }
  }
  const meeting = nextMeeting(site.meetings, now, groupId)
  return meeting ? { meeting, internal: false } : null
}

export function GroupsPage(props: { site: SiteSnapshot | null; now: LocalDateTime; today: CalendarDate }) {
  const { site } = props
  return (
    <>
      <h1>Gruppi</h1>
      <p class="sub">I Gruppi di Lavoro (GdL): cosa fanno, chi li segue e come si partecipa.</p>
      {!site ? (
        <p role="status">{SITE_MISSING}</p>
      ) : site.groups.length === 0 ? (
        <p role="status">Non ci sono ancora gruppi.</p>
      ) : (
        <ul class="elenco">
          {site.groups.map((group) => {
            const meeting = nextMeeting(site.meetings, props.now, group.id)
            return (
              <li class="card">
                <a class="voce" href={`/gruppi/${encodeURIComponent(group.id)}`}>
                  {group.name}
                </a>
                {group.mission && <p>{group.mission}</p>}
                {meeting && <p class="small">Prossimo incontro: {formatMeeting(meeting.startsAt, props.today)}</p>}
              </li>
            )
          })}
        </ul>
      )}
      <a class="btn sec" href="/primo-giorno">
        Il primo giorno: come si entra in un gruppo
      </a>
    </>
  )
}

function Contact({ group, officeUrl }: { group: SiteGroup; officeUrl: string | null }) {
  if (group.chatUrl)
    return (
      <>
        <p>La chat del gruppo è aperta ai soci: entra e presentati.</p>
        <a class="btn" href={group.chatUrl}>
          Entra nella chat del gruppo
        </a>
      </>
    )
  return (
    <>
      <p>La chat del gruppo è solo per chi partecipa. Scrivi alla segreteria: ti mette in contatto coi referenti.</p>
      {officeUrl && (
        <a class="btn sec" href={officeUrl}>
          Scrivi alla segreteria
        </a>
      )}
    </>
  )
}

export function GroupPage(props: {
  group: SiteGroup
  site: SiteSnapshot
  reserved: ReservedSnapshot | null
  person: ReservedPerson | null
  now: LocalDateTime
  today: CalendarDate
}) {
  const { group, site } = props
  const next = groupMeeting(group.id, site, props.reserved, props.person, props.now)
  const mine = repGroupId(props.person) === group.id
  const reservedGroup = props.reserved?.groups.find((candidate) => candidate.id === group.id)
  return (
    <>
      <h1>{group.name}</h1>
      <p class="sub">{group.mission || 'Gruppo di Lavoro di RAMI.'}</p>
      {mine && (
        <section class="card mia" aria-labelledby="mio-gruppo">
          <h2 id="mio-gruppo">È il tuo gruppo</h2>
          <a class="btn sec" href="/cantieri?filtro=mio">
            Aggiorna il tuo gruppo
          </a>
          {reservedGroup?.newMeetingUrl && (
            <a class="btn sec" href={reservedGroup.newMeetingUrl}>
              Aggiungi un incontro
            </a>
          )}
        </section>
      )}

      <h2>Chi lo segue</h2>
      {group.referents.length ? (
        <ul class="referenti">
          {group.referents.map((referent) => (
            <li>{referentLabel(referent)}</li>
          ))}
        </ul>
      ) : (
        <p>Il gruppo non ha ancora un referente.</p>
      )}

      <h2>Come si partecipa</h2>
      <p>{group.howToJoin || 'Scrivi alla segreteria: ti mette in contatto coi referenti.'}</p>

      <h2>Dove e quando</h2>
      <p>{group.whereWhen || 'Il gruppo non l’ha ancora scritto.'}</p>

      <h2 id="incontro">Prossimo incontro</h2>
      {next ? (
        <div class="card">
          <MeetingCard meeting={next.meeting} internal={next.internal} today={props.today} />
        </div>
      ) : (
        <p>Nessun incontro in calendario nei prossimi 60 giorni.</p>
      )}

      <h2>Come contattarlo</h2>
      <Contact group={group} officeUrl={site.officeUrl} />
    </>
  )
}
