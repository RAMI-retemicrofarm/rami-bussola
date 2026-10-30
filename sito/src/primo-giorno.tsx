// /primo-giorno: i passi per entrare in un GdL, dalla scheda «Primo giorno» del Foglio.
import type { SiteSnapshot } from '@bussola/condiviso'

export function FirstDayPage({ site }: { site: SiteSnapshot | null }) {
  const steps = site?.firstDay ?? []
  return (
    <>
      <h1>Il primo giorno</h1>
      <p class="sub">Come si entra in un Gruppo di Lavoro, passo per passo.</p>
      {!site ? (
        <p role="status">I passi non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.</p>
      ) : steps.length === 0 ? (
        <p role="status">I passi non sono ancora scritti: intanto guarda i Gruppi.</p>
      ) : (
        <ol class="passo-passo">
          {steps.map((step) => (
            <li class="card">
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              {step.url && (
                <a class="btn sec mini" href={step.url}>
                  Apri<span class="vh">: {step.title}</span>
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      <a class="btn" href="/gruppi">
        Guarda i Gruppi
      </a>
    </>
  )
}
