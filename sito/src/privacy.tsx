// L'informativa della Bussola, una sola per tutto il sito, e la pagina del dominio dei soci finché l'entrata dei
// soci non c'è. Il testo lo conferma il segretario prima che si carichi l'anagrafica vera: finché non l'ha fatto, la
// pagina lo dice in cima. Ciò che le fonti non dicono sta fra parentesi quadre, ben visibile.
import { RESERVED_ORIGIN } from './security.ts'

/** Diventa true quando il segretario conferma il testo; insieme si aggiorna la data della versione. */
export const PRIVACY_CONFIRMED = false
export const PRIVACY_VERSION = '2026-10-20'

const CONTACT = 'segreteria@retemicrofarm.it'

const versionFormat = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeZone: 'UTC' })

export function PrivacyPage({
  confirmed = PRIVACY_CONFIRMED,
  version = PRIVACY_VERSION,
}: {
  confirmed?: boolean
  version?: string
}) {
  return (
    <>
      <h1>Come usiamo i dati</h1>
      {!confirmed && <p class="bozza">Bozza: il testo aspetta la conferma del segretario.</p>}
      <p class="sub">
        L’informativa sulla privacy della Bussola, lo strumento con cui RAMI segue la vita dell’associazione: i cantieri
        dei Gruppi di Lavoro (GdL), le scadenze, le delibere e le quote. Vale per tutta la Bussola.
      </p>
      <p class="piccolo">Versione del {versionFormat.format(new Date(`${version}T00:00:00Z`))}.</p>
      {/* I salti alle tre parti che si cercano di più: la pagina è lunga, e sul telefono si scorre tanto. */}
      <nav class="salti" aria-label="Su questa pagina">
        <a href="#diritti">I tuoi diritti</a>
        <a href="#tempi">Quanto li teniamo</a>
        <a href="#chi">Chi tratta i tuoi dati</a>
      </nav>

      <h2 id="chi">Chi tratta i tuoi dati</h2>
      <p>
        Il titolare del trattamento è RAMI, Rete Agroecologica Microfarm Italia APS, con sede in via Ernesto Rossi 20,
        00155 Roma, codice fiscale 17878191000.
      </p>
      <p>Per ogni domanda sui tuoi dati scrivi alla segreteria: ti risponde il segretario.</p>
      <a class="btn sec" href={`mailto:${CONTACT}`}>
        Scrivi a {CONTACT}
      </a>

      <h2>Quali dati e perché</h2>
      <ul>
        <li>
          <b>Se sei socio o socia</b>: i dati del libro soci (numero, nome, cognome, tipo di socio, data di ammissione
          ed eventuale recesso), la mail e il telefono, le quote e i pagamenti, e le comunicazioni che la segreteria ti
          manda. Servono a tenere il libro soci, a sapere chi è in regola e a mandarti convocazioni e solleciti.
        </li>
        <li>
          <b>Se partecipi a un GdL</b>: i cantieri del gruppo, cioè cosa si fa, a che punto è e cosa serve. Se aggiorni
          un cantiere dal Modulo, il tuo nome e ciò che scrivi, per sapere chi ha fatto l’aggiornamento e chi può
          aiutare. Se sei referente, il tuo nome e il tuo ruolo compaiono nella Bussola solo se dai il consenso.
        </li>
        <li>
          <b>Se sei del Direttivo, del Coordinamento o della segreteria</b>: la tua mail e i tuoi ruoli, per farti
          entrare nella Riservata, la parte con scadenze, delibere e budget.
        </li>
        <li>
          <b>Per sapere quanto si usa la Bussola</b>: contiamo le persone diverse di ogni mese con un’impronta, un
          codice ricavato dal numero di socio o dalla mail da cui non si legge chi sei.
        </li>
      </ul>
      <p>Del sito non teniamo registri delle visite.</p>

      <h2>Su cosa si basa</h2>
      <ul>
        <li>
          Per i soci, il rapporto associativo e gli obblighi di legge, come il libro soci e le scritture contabili.
        </li>
        <li>
          Per i rappresentanti dei GdL che non sono soci, il legittimo interesse di RAMI a coordinare i Gruppi di
          Lavoro.
        </li>
        <li>Per il nome e il ruolo dei referenti, il consenso, che puoi ritirare quando vuoi.</li>
      </ul>

      <h2>Dove stanno</h2>
      <ul>
        <li>
          <b>Su Google</b>, nel Drive di RAMI: l’anagrafica, le quote e i pagamenti, in un Foglio dell’account della
          segreteria. Lo leggono solo il segretario, la segreteria part-time, il tesoriere e chi cura la Bussola, che
          come amministratore del sistema può leggere tutto. Il Direttivo vede le copie del libro soci, senza mail,
          telefono e note.
        </li>
        <li>
          <b>Su Cloudflare</b>, dove gira il sito: una copia per leggere, senza l’anagrafica. Ci sono numeri di socio,
          conteggi e impronte, mai i nomi, salvo il nome e il ruolo dei referenti che hanno dato il consenso.
        </li>
        <li>
          <b>Cloudflare Access</b> fa entrare nella Riservata Direttivo, Coordinamento e segreteria. Riceve le mail
          della lista delle persone ammesse, ti manda per mail il codice per entrare e tiene la sessione aperta fino a
          un mese. Conserva per 24 ore i registri degli accessi: mail, indirizzo IP, paese, ora ed esito.
        </li>
      </ul>
      <p>
        Google e Cloudflare sono società degli Stati Uniti, e i dati possono passare da loro server fuori dall’Unione
        europea. Tutte e due aderiscono al Data Privacy Framework fra Unione europea e Stati Uniti; se venisse meno, i
        loro contratti prevedono le clausole contrattuali standard della Commissione europea.
      </p>
      <p>
        Più avanti la Bussola farà una copia di sicurezza cifrata dei dati su Backblaze, passando da GitHub. Prima di
        accenderla aggiorneremo questa informativa, con dove sta la copia e chi la fa.
      </p>

      <h2>Cookie e memoria del telefono</h2>
      <p>Usiamo solo cookie tecnici, che servono a far funzionare la Bussola: per questo non c’è un banner.</p>
      <ul>
        <li>
          <b>CF_Authorization</b>, di Cloudflare Access, su rami-bussola.pages.dev: tiene aperta la sessione della
          Riservata.
        </li>
        <li>
          <b>Da gennaio, il cookie di sessione dei soci</b>: il tuo telefono si ricorda che sei entrato.
        </li>
        <li>
          <b>Da gennaio, il cookie di «Mandami un nuovo link»</b>: evita che se ne chiedano troppi di fila.
        </li>
        <li>
          <b>Più avanti, la memoria della scheda del browser</b>, per ricordare che hai aperto un Modulo Google.
        </li>
        <li>
          <b>Nella pagina della segreteria</b>, chi la sta usando, salvato sul dispositivo.
        </li>
      </ul>

      <h2 id="tempi">Quanto li teniamo</h2>
      <ul>
        <li>
          Chi esce dall’associazione: restano i dati del libro soci, come chiede la legge; mail e telefono si cancellano
          12 mesi dopo il recesso.
        </li>
        <li>I pagamenti: 10 anni, come le scritture contabili. L’estratto conto: l’anno in corso e quello prima.</li>
        <li>Le comunicazioni mandate (solleciti, convocazioni, link) e le risposte ai Moduli: 2 anni.</li>
        <li>Il registro dei cambi di chi entra nell’area della segreteria: 2 anni.</li>
        <li>Il registro delle richieste sui dati e delle violazioni: 5 anni da quando si chiudono.</li>
        <li>I link personali: 12 mesi dopo la scadenza o il ritiro.</li>
        <li>Le candidature e gli aggiornamenti sugli impegni: 1 anno dopo la chiusura dell’impegno.</li>
        <li>Le richieste di entrare in un GdL: 1 anno.</li>
        <li>Le persone della Riservata e la lista di Cloudflare Access: finché hai il ruolo.</li>
        <li>I registri degli accessi di Cloudflare Access: 24 ore.</li>
        <li>Le impronte per contare l’uso: al più 70 giorni.</li>
        <li>
          Se ritiri il consenso come referente, il tuo nome sparisce dal sito entro 10 minuti. Quando ci sarà la copia
          di sicurezza, ciò che cancelliamo sparirà anche dalle copie entro 90 giorni.
        </li>
      </ul>

      <h2 id="diritti">I tuoi diritti</h2>
      <p>Puoi chiedere di:</p>
      <ul>
        <li>vedere i tuoi dati e averne una copia (accesso);</li>
        <li>correggerli (rettifica);</li>
        <li>
          cancellarli (cancellazione), salvo quelli che la legge ci chiede di tenere, come il libro soci e i pagamenti;
        </li>
        <li>limitarne l’uso (limitazione);</li>
        <li>opporti a un uso (opposizione);</li>
        <li>riceverli in un file da portare altrove (portabilità).</li>
      </ul>
      <p>Scrivi a {CONTACT}: ti risponde il segretario, entro un mese.</p>
      <p>Puoi anche fare reclamo al Garante per la protezione dei dati personali.</p>
      <a class="btn sec" href="https://www.garanteprivacy.it">
        Il sito del Garante
      </a>

      <h2>Da gennaio, per i soci</h2>
      <p>
        A gennaio la Bussola si apre ai soci. Riceverai per mail un link personale per entrare, che vale al più 24 mesi:
        di quel link teniamo solo un’impronta. Poi il telefono si ricorda di te con il cookie di sessione, che vale
        finché puoi entrare, per esempio finché la quota è in regola.
      </p>
      <p>
        Se chiederai di partecipare a un GdL, la richiesta arriverà per mail al referente del gruppo. Se ti candiderai
        per un impegno, la candidatura arriverà a chi l’ha proposto, in copia alla segreteria.
      </p>
    </>
  )
}

/** Il dominio dei soci, finché l'entrata dei soci non c'è: nessun dato, due strade e a chi scrivere. */
export function SoonPage() {
  return (
    <>
      <h1>La Bussola dei soci apre a gennaio.</h1>
      <p class="sub">Intanto puoi leggere come useremo i tuoi dati.</p>
      <a class="btn sec" href="/privacy">
        Come usiamo i dati dei soci
      </a>
      <p class="dopo-tasto">Sei del Direttivo, del Coordinamento o della segreteria?</p>
      <a class="btn sec" href={RESERVED_ORIGIN}>
        Vai alla Riservata
      </a>
      {/* L'indirizzo a parte: dentro il tasto, su iPhone andava a capo a metà; qui va a capo solo con lo zoom. */}
      <p class="small">L’indirizzo è rami-bussola.pages.dev.</p>
      <p class="dopo-tasto">Domande?</p>
      <a class="btn sec" href={`mailto:${CONTACT}`}>
        Scrivi a {CONTACT}
      </a>
    </>
  )
}
