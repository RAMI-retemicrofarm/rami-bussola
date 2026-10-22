// /cantieri: l'elenco dei cantieri aperti e, per il rappresentante, i tasti del suo GdL (schermata 3, flusso C). In
// T1 i dati vengono dall'istantanea riservata, dietro Access; i filtri arrivano in T7. Il referente sulla scheda
// arriva col consenso dei referenti, in T7: fino ad allora nessun nome esce.
import {
  projectSignals,
  type CalendarDate,
  type ReservedPerson,
  type ReservedProject,
  type ReservedSnapshot,
} from '@bussola/condiviso'
import { formatDay, overdueLabel, Signal, sinceUpdate, StageLine } from './ui.tsx'

function ProjectCard(props: {
  project: ReservedProject
  groupName: string
  mine: boolean
  today: CalendarDate
  staleDays: number
}) {
  const { project, today } = props
  const signals = projectSignals(project, today, props.staleDays)
  return (
    <article class="card">
      <h2 class="scheda-titolo">{project.title}</h2>
      <p class="small">GdL {props.groupName}</p>
      <StageLine stage={project.stage} />
      <dl class="dati">
        <dt>Prossimo passo</dt>
        <dd>{project.nextStep || '—'}</dd>
        <dt>Scadenza</dt>
        <dd>
          {project.dueOn ? formatDay(project.dueOn, today) : 'non c’è'}
          {signals.lateByDays !== null && <span class="bad"> · {overdueLabel(signals.lateByDays)}</span>}
        </dd>
      </dl>
      {signals.needsUpdate ? (
        <Signal tone="bad" shape="tri">
          Da aggiornare · {sinceUpdate(signals.daysSinceUpdate)}
        </Signal>
      ) : (
        <Signal tone="ok" shape="pieno">
          Aggiornato {sinceUpdate(signals.daysSinceUpdate)}
        </Signal>
      )}
      {props.mine && project.updateUrl && (
        <a class="btn" href={project.updateUrl}>
          Aggiorna il tuo gruppo<span class="vh">: {project.title}</span>
        </a>
      )}
    </article>
  )
}

export function CantieriPage(props: {
  snapshot: ReservedSnapshot | null
  person: ReservedPerson | null
  today: CalendarDate
}) {
  const { snapshot, today } = props
  const heading = (
    <>
      <h1>Cantieri</h1>
      <p class="sub">Cosa stanno facendo i gruppi.</p>
    </>
  )
  if (!snapshot)
    return (
      <>
        {heading}
        <p role="status">I cantieri non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.</p>
      </>
    )

  const groups = new Map(snapshot.groups.map((group) => [group.id, group]))
  const myGroupId = props.person?.roles.includes('rep') ? props.person.groupId : null
  const myGroup = myGroupId ? groups.get(myGroupId) : undefined
  const groupName = (project: ReservedProject) => groups.get(project.groupId)?.name ?? project.groupId
  const projects = [...snapshot.projects].sort(
    (a, b) =>
      Number(b.groupId === myGroupId) - Number(a.groupId === myGroupId) ||
      groupName(a).localeCompare(groupName(b), 'it') ||
      a.title.localeCompare(b.title, 'it'),
  )

  return (
    <>
      {heading}
      {myGroup && (
        <section class="card mia" aria-labelledby="mio-gruppo">
          <h2 id="mio-gruppo">Sei referente di: GdL {myGroup.name}</h2>
          {projects.some((project) => project.groupId === myGroup.id) ? (
            <p class="small">
              Su ogni cantiere del tuo gruppo c’è «Aggiorna il tuo gruppo»: si apre un modulo con gruppo e cantiere già
              scritti. Cambi stato, prossimo passo e scadenza, poi tocchi «Invia». Ci vuole un minuto.
            </p>
          ) : (
            <p>Questo gruppo non ha ancora cantieri.</p>
          )}
          {myGroup.newProjectUrl && (
            <a class="btn sec" href={myGroup.newProjectUrl}>
              Aggiungi un cantiere
            </a>
          )}
        </section>
      )}
      {projects.length === 0 && <p role="status">Non ci sono cantieri aperti.</p>}
      {projects.map((project) => (
        <ProjectCard
          project={project}
          groupName={groupName(project)}
          mine={project.groupId === myGroupId}
          today={today}
          staleDays={snapshot.staleDays}
        />
      ))}
      <p class="small">
        «Da aggiornare» compare quando un cantiere non si aggiorna da {snapshot.staleDays} giorni o più, o quando la
        scadenza del prossimo passo è passata.
      </p>
    </>
  )
}
