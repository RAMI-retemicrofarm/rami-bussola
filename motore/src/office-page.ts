// La pagina della segreteria: un documento solo, con CSS e JS dentro, perché Apps Script carica solo `Code.js` e
// HtmlService serve l'HTML che gli si passa (docs/design/sistema.md, «Nella web app di Google»). Arriva subito con lo
// scheletro, poi chiede i dati al motore con `google.script.run` (le chiamate e le risposte sono in office-api.ts).
// Il JS è per il browser (Safari iOS e Chrome Android recenti), senza framework. Sta in `String.raw`, così le barre
// rovesciate restano com'è scritto: per questo dentro non ci sono né backtick né dollaro con graffa.

const ICON =
  'class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'

// I token, la scala e le classi della vetrina (sito/public/static/style.css), con gli stessi nomi: `main`, `.stato`,
// `.vh`, così la definizione di fatto delle E2E vale anche qui. Larghezza massima 720 px, quella della segreteria.
const CSS = String.raw`
:root {
  color-scheme: light;
  --paper: #fbf7ee;
  --card: #fffdf8;
  --ink: #2a2620;
  --muted: #5e564a;
  --brand: #2d4a36;
  --brand-tint: #e2eee1;
  --ok: #2d6a3e;
  --warn: #85550a;
  --warn-tint: #f6ebd3;
  --bad: #a3321f;
  --bad-tint: #f7e3dd;
  --rule: #d9cfba;
  --line-ui: #8a7f6a;
  --focus: #1d5fa8;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { font-size: 17px; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.45;
  overflow-wrap: break-word;
}
.testata, main, .piede { width: 100%; max-width: 720px; margin: 0 auto; padding: 0 16px; }
.testata { padding-top: 12px; }
main { padding-bottom: 16px; }
.marchio { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--brand); font-weight: 800; font-size: 19px; }
.marchio .ic { width: 22px; height: 22px; flex: none; }
h1 { font-size: 27px; line-height: 1.2; margin: 26px 0 4px; }
/* Dopo le sezioni il titolo sta più vicino: i numeri di Soci arrivano prima. */
.sezioni + h1 { margin-top: 14px; }
h2 { font-size: 19px; line-height: 1.3; margin: 26px 0 10px; }
h3 { font-size: 18px; line-height: 1.3; margin: 0 0 4px; }
p { margin: 0 0 8px; }
.sub { color: var(--muted); margin: 0 0 14px; }
.small { font-size: 14px; color: var(--muted); }
a { color: var(--brand); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
[tabindex="-1"]:focus { outline: none; }
button { font: inherit; color: inherit; cursor: pointer; }

/* La fascia della stanza: dice dove sei e chi può vederlo. */
.stanza {
  display: flex; gap: 8px; align-items: center; margin: 12px 0 0; padding: 7px 16px;
  font-size: 14px; font-weight: 700; background: var(--warn-tint); color: #6b4408; border-bottom: 3px solid var(--warn);
}
.stanza .ic { width: 18px; height: 18px; flex: none; }

.card { background: var(--card); border: 1px solid var(--rule); border-radius: 14px; padding: 14px 16px; margin: 0 0 10px; }

.btn {
  display: block; width: 100%; min-height: 52px; border: 0; border-radius: 12px; background: var(--brand); color: #fff;
  font-weight: 700; font-size: 18px; line-height: 1.3; text-align: center; text-decoration: none; padding: 14px 16px;
  margin: 12px 0 4px;
}
.btn.sec { background: var(--card); color: var(--brand); border: 2px solid var(--brand); padding: 12px 16px; }
.btn.mini {
  display: inline-flex; align-items: center; width: auto; min-height: 44px; min-width: 44px; padding: 8px 16px;
  font-size: 15px; margin: 8px 0 0;
}
.btn:disabled { background: #d6cfbf; color: #4f483d; border-color: #d6cfbf; cursor: default; }

/* Gli stati: parola, forma e colore insieme. */
.stato { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; font-size: 15px; }
p.stato { display: flex; margin: 8px 0 0; }
.dot { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; flex: none; }
.dot.pieno { background: currentColor; }
.dot.mezzo { background: linear-gradient(90deg, currentColor 50%, transparent 50%); }
.tri { width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 12px solid currentColor; flex: none; }
/* Il trattino: niente da fare, il socio è uscito o il pagamento non conta più. */
.linea { width: 14px; height: 4px; border-radius: 2px; background: currentColor; flex: none; }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.bad { color: var(--bad); font-weight: 700; }
.muto { color: var(--muted); }

dl.dati { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0; font-size: 15px; }
dl.dati dt { color: var(--muted); }
dl.dati dd { margin: 0; font-weight: 600; min-width: 0; }
.riga { padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 15px; }
.riga:first-child { padding-top: 0; }
.riga:last-child { border-bottom: 0; padding-bottom: 0; }
.riga p { margin: 0 0 2px; }
p.riga { margin: 0; }
.etichetta { font-weight: 700; }

/* Quattro numeri: due per riga sul telefono, quattro in fila quando c'è posto. */
.numeri { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr)); gap: 8px; }
.numeri .card { text-align: center; margin: 0; padding: 12px 6px; font-size: 14px; line-height: 1.4; }
.numeri b { display: block; font-size: 30px; line-height: 1.1; }
.totale { margin: 10px 0 4px; font-size: 15px; }

/* Le due schermate interne, Soci e Oggi: la voce attiva ha la barretta e il grassetto, non solo il colore. */
/* Con «N da guardare» e lo zoom al 200% le due voci non stanno in fila: vanno a capo, ognuna intera. */
.sezioni { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 12px 0 0; border-bottom: 1px solid var(--rule); }
.sezioni button {
  flex: 1 1 8rem; min-height: 48px; background: none; border: 0; border-bottom: 4px solid transparent; color: var(--muted);
  font-size: 17px; font-weight: 600;
}
.sezioni button[aria-current="page"] { color: var(--brand); font-weight: 800; border-bottom-color: var(--brand); }
.sezioni button:focus-visible { outline-offset: -3px; }
.sezioni .stato { display: flex; justify-content: center; }

.indietro {
  display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; margin: 12px 0 0; padding: 0 8px 0 0;
  background: none; border: 0; color: var(--brand); font-weight: 700;
}
.collegamento {
  display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 8px; background: none;
  border: 0; color: var(--brand); font-weight: 700; text-decoration: underline;
}

/* I campi: etichetta sopra, bordo --line-ui, almeno 16 px perché iOS non ingrandisca. */
.campo { margin: 18px 0; }
.campo label, .campo .etichetta, .scelte legend { display: block; margin: 0 0 4px; font-weight: 700; font-size: 15px; }
.hint { margin: 0 0 6px; font-size: 14px; color: var(--muted); }
input[type="text"], input[type="search"], input[type="date"], textarea, select {
  display: block; width: 100%; min-width: 0; min-height: 48px; padding: 10px 12px; border: 2px solid var(--line-ui);
  border-radius: 12px; background: #fff; color: var(--ink); font: inherit; font-size: 17px;
}
textarea { min-height: 88px; resize: vertical; }
/* A 320 px con lo zoom al 200% la data di WebKit ci sta solo con 8 px ai lati. */
input[type="date"] { padding-left: 8px; padding-right: 8px; }
input[aria-invalid="true"], textarea[aria-invalid="true"] { border-color: var(--bad); }
.euro { display: flex; align-items: center; gap: 8px; }
.euro input { flex: 1; max-width: 10rem; }
.euro span { font-weight: 700; }
.errore { margin: 6px 0 0; color: var(--bad); font-weight: 700; font-size: 15px; }
.errore:empty { margin: 0; }
.scelte { margin: 18px 0; padding: 0; border: 0; min-width: 0; }
.scelte legend { padding: 0; }
.scelta {
  display: inline-flex; align-items: center; gap: 10px; min-height: 48px; margin: 0 8px 8px 0; padding: 8px 16px 8px 12px;
  border: 2px solid var(--line-ui); border-radius: 12px; background: #fff; font-weight: 600;
}
.scelta:has(input:checked) { border-color: var(--brand); background: var(--brand-tint); }
.scelta input { width: 22px; height: 22px; margin: 0; accent-color: var(--brand); }
.scelto { margin: 0; font-weight: 700; }

/* Ricerca e filtri dei soci. */
.filtri { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
.filtri button {
  min-height: 44px; padding: 8px 14px; border: 2px solid var(--line-ui); border-radius: 999px; background: var(--card);
  font-size: 15px;
}
.filtri button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 700; }
.elenco, .proposte { list-style: none; margin: 0; padding: 0; }
.elenco li { margin: 0 0 10px; }
.socio {
  display: block; width: 100%; padding: 14px 16px; border: 1px solid var(--rule); border-radius: 14px;
  background: var(--card); text-align: left;
}
/* Due righe: nome, numero e stato (a destra) sopra, l'ultima quota sotto. */
.socio-testa { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 2px 12px; margin: 0 0 4px; }
.socio-nome { font-size: 18px; font-weight: 700; line-height: 1.3; min-width: 0; }
.socio-dati { display: block; font-size: 15px; color: var(--muted); }
.proposte li { margin: 8px 0 0; }
.proposta {
  display: block; width: 100%; min-height: 44px; padding: 10px 14px; border: 2px solid var(--line-ui); border-radius: 12px;
  background: #fff; text-align: left;
}

.azioni { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; }
.azioni .btn.mini { margin: 0; }
.nota { white-space: pre-line; font-size: 15px; }
.chi, .sei { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; margin: 12px 0 0; }
.sei { margin: 2px 0 0; }
.cambia { display: inline-flex; align-items: center; white-space: nowrap; }
.cambia .collegamento { padding-left: 6px; }
.sotto { display: block; margin: 4px 0 0; }
/* Il riquadro di avviso: bordo e fondo tenue, e la parola in grassetto davanti. */
.avviso { margin: 8px 0 0; padding: 10px 12px; border-left: 4px solid var(--warn); border-radius: 0 10px 10px 0; background: var(--warn-tint); }

/* Lo scheletro: c'è subito, mentre il motore si sveglia. */
.scheletro i { display: block; height: 64px; margin: 0 0 10px; border-radius: 14px; background: #ece4d3; }

.piede { margin-top: 24px; padding-top: 12px; padding-bottom: 32px; border-top: 1px solid var(--rule); }
.piede a { display: inline-flex; align-items: center; min-height: 44px; font-weight: 700; }

/* Per chi legge con il lettore di schermo: il testo c'è, ma non si vede. */
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`

/**
 * Le parole e i formati della pagina: funzioni pure, senza DOM né stato, che lo script include così come sono.
 * Stanno a parte perché office-page.test.ts le prova una per una, fuori dal browser.
 */
export const OFFICE_PAGE_WORDS = String.raw`
  // --- Le parole e i formati
  const STATUS = {
    left: ["Receduto", "muto", "linea"],
    inGoodStanding: ["In regola", "ok", "dot pieno"],
    paidAhead: ["Già in regola per il ", "ok", "dot pieno"],
    dueForRenewal: ["Da rinnovare", "warn", "dot"],
    notInGoodStanding: ["Non in regola", "bad", "tri"],
  }
  const METHOD = { transfer: "bonifico", cash: "contanti", register: "dal libro soci" }
  const METHOD_NAME = { transfer: "Bonifico", cash: "Contanti", register: "Dal libro soci" }
  const KEEPER = "chi cura la Bussola"

  function dmy(date) {
    const p = String(date || "").split("-")
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""
  }
  function dm(date) {
    const p = String(date || "").split("-")
    return p.length === 3 ? p[2] + "/" + p[1] : ""
  }
  function euro(amount) {
    const text = String(amount).trim()
    const value = typeof amount === "number" ? amount : Number(text.replace(",", "."))
    if (text === "" || !isFinite(value)) return text + " €"
    return (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",")) + " €"
  }
  // I giorni da una data all'altra, entrambe «AAAA-MM-GG»: NaN se una non si legge.
  function daysFrom(from, to) {
    const utc = (date) => {
      const p = String(date).split("-").map(Number)
      return Date.UTC(p[0], p[1] - 1, p[2])
    }
    return Math.round((utc(to) - utc(from)) / 86400000)
  }

  // Un cambio del «Registro di Accessi» in una frase. Per più celle Google non dà il valore di prima
  // (access-log.ts): la frase dice solo il dopo, per non scrivere «prima vuota» quando non si sa.
  function accessChangeText(c) {
    const at = /^(\d{2}\/\d{2})\/\d{4} (\d{2}:\d{2})$/.exec(c.when)
    const when = at ? at[1] + " alle " + at[2] : c.when
    const rows = /^[A-Z]*(\d+)(?::[A-Z]*(\d+))?$/i.exec(String(c.cells).trim())
    const first = rows ? Number(rows[1]) : 0
    const last = rows && rows[2] ? Number(rows[2]) : first
    const one = rows && first === last
    const where = !rows
      ? "le celle " + c.cells + " di «Accessi» sono cambiate"
      : one
        ? "la riga " + first + " di «Accessi» è cambiata"
        : "le righe " + Math.min(first, last) + "–" + Math.max(first, last) + " di «Accessi» sono cambiate"
    const value = (v) => (v ? "«" + v + "»" : one ? "vuota" : "vuote")
    const single = !/:/.test(c.cells) && !!rows
    const what = (single ? "prima " + value(c.before) + ", " : "") + "ora " + value(c.after)
    const who = !c.who || c.who === "non noto" ? "Non si sa chi l'ha fatto." : "L'ha fatto " + c.who + "."
    return when + " " + where + ": " + what + ". " + who
  }
  // Il controllo delle condivisioni gira ogni giorno: oltre due giorni di silenzio qualcosa si è fermato.
  function sharingWarning(checkedOn, today) {
    if (!checkedOn) return "Il controllo delle condivisioni non ha ancora girato: avvisa " + KEEPER + "."
    return daysFrom(checkedOn, today) > 2
      ? "Il controllo delle condivisioni non gira dal " + dmy(checkedOn) + ": avvisa " + KEEPER + "."
      : ""
  }
  // «il Foglio soci» → «dal Foglio soci», «la cartella «Bussola»» → «dalla cartella «Bussola»».
  function revokeAdvice(s) {
    const from = /^il /.test(s.where) ? s.where.replace(/^il /, "dal ") : /^la /.test(s.where) ? s.where.replace(/^la /, "dalla ") : "da " + s.where
    // «chiunque abbia il link» non è una persona da mettere in «Accessi».
    return /@/.test(s.account)
      ? "Togli l'accesso " + from + ", oppure aggiungi la persona in «Accessi»."
      : "Togli l'accesso " + from + "."
  }
  function emptySearchText(query, filterLabel) {
    const text = String(query).trim()
    if (!text) return "Nessun socio in questo elenco."
    if (!filterLabel) return "Nessun socio con «" + text + "»."
    return "Nessun socio con «" + text + "» fra quelli «" + filterLabel + "». Tocca «Tutti» per cercare fra tutti."
  }
  // La riga della conferma, come [testo, colore, forma]: «in regola» solo se lo stato dopo il pagamento lo dice.
  function outcomeLine(r) {
    if (!r.payment.memberNumber) return ["Registrato senza socio: va in «Da abbinare».", "warn", "dot mezzo"]
    if (r.pending) return ["Registrato. Il pagamento è in attesa del tesoriere: conta quando lo conferma.", "warn", "dot mezzo"]
    const year = r.payment.validYear
    if (r.status === "inGoodStanding" || r.status === "paidAhead") return ["Registrato. " + r.memberName + " è in regola per il " + year + ".", "ok", "dot pieno"]
    const label = STATUS[r.status]
    return [label ? "Registrato per il " + year + ". Lo stato di " + r.memberName + " è «" + label[0] + "»." : "Registrato per il " + year + ".", "warn", "dot mezzo"]
  }
  function noAccessText(email) {
    const rest = "se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a " + KEEPER + "."
    return email ? "Stai usando l'account " + email + ". Entra con quello della segreteria: " + rest : "Entra con l'account della segreteria: " + rest
  }
`

// Il JS del browser. Ogni chiamata al motore passa da `call`, che spegne il tasto, scrive l'attesa e mette il failure
// handler: c'è un solo `google.script.run`. I testi a schermo sono quelli di docs/design/flussi-critici.md, flusso D.
const SCRIPT =
  String.raw`
(() => {
  "use strict"
  const KEY = "bussola.segreteria.chiSei"
  const OFFLINE = "Non c'è connessione. Controlla il Wi-Fi o i dati del telefono, poi tocca «Riprova»."
  const NOT_SAVED = "Non siamo sicuri che sia stato salvato. Riprova: se c'era già, non si duplica."
  const SLOW = "Ci mette più del solito. Non toccare di nuovo."
  const $main = document.getElementById("main")
  const $piede = document.getElementById("piede")
  const $sei = document.getElementById("sei")

  const state = { person: savedPerson(), view: null, keys: [], soci: null, filter: "all", query: "", draft: null, busy: false }

  // Il nome resta sul dispositivo, non sull'account: se la cornice di Google non lo lascia, si chiede ogni volta.
  function savedPerson() {
    try { return localStorage.getItem(KEY) || "" } catch (e) { return "" }
  }
  function savePerson(name) {
    try { localStorage.setItem(KEY, name) } catch (e) { /* si chiede alla prossima apertura */ }
  }

  // Un elemento del DOM. Il testo entra sempre come testo, mai come HTML: i nomi vengono dal Foglio.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag)
    for (const name in attrs || {}) {
      const value = attrs[name]
      if (value == null || value === false) continue
      if (name === "class") el.className = value
      else if (name.startsWith("on")) el.addEventListener(name.slice(2), value)
      else el.setAttribute(name, value === true ? "" : String(value))
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child)
    return el
  }

` +
  OFFICE_PAGE_WORDS +
  String.raw`
  function stato(tag, color, shape, word) {
    return h(tag, { class: "stato " + color }, h("span", { class: shape, "aria-hidden": "true" }), word)
  }
  function memberStato(member, tag) {
    const [word, color, shape] = STATUS[member.status] || STATUS.notInGoodStanding
    return stato(tag || "span", color, shape, member.status === "paidAhead" ? word + (state.view.year + 1) : word)
  }
  function fullName(member) {
    return (member.firstName + " " + member.lastName).trim()
  }
  function norm(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  }
  function tokens(text) {
    return norm(text).split(/\s+/).filter(Boolean)
  }
  function capital(text) {
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  function newKey() {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }
  function lastQuota(member) {
    const p = member.payments.find((payment) => payment.status !== "cancelled")
    if (!p) return "Nessuna quota registrata"
    const how = p.method === "register" ? METHOD.register : METHOD[p.method] + (p.date ? " del " + dmy(p.date) : "")
    return "Vale per " + p.validYear + " · " + how + (p.status === "pendingTreasurer" ? " · in attesa del tesoriere" : "")
  }

  // --- Le chiamate al motore, con l'attesa: sotto 1 secondo niente, poi il tasto spento, oltre 8 secondi l'avviso.
  // Il secondo tocco non parte mai, nemmeno prima del secondo: lo ferma «busy».
  function isOffline(error) {
    return navigator.onLine === false || /network|connection|HTTP 0|failed to fetch/i.test(String((error && error.message) || error))
  }
  function call(name, arg, opts) {
    if (state.busy) return
    const run = window.google && window.google.script && window.google.script.run
    if (navigator.onLine === false || !run) return opts.fail({ offline: navigator.onLine === false })
    state.busy = true
    const button = opts.button
    const label = button && button.textContent
    const t1 = setTimeout(() => {
      if (!button) return
      button.disabled = true
      button.textContent = opts.wait || "Un attimo…"
    }, 1000)
    const t8 = setTimeout(() => { if (opts.slot) opts.slot.textContent = SLOW }, 8000)
    const done = () => {
      clearTimeout(t1)
      clearTimeout(t8)
      state.busy = false
      if (button) { button.disabled = false; button.textContent = label }
      if (opts.slot) opts.slot.textContent = ""
    }
    run
      .withSuccessHandler((result) => {
        done()
        if (result && result.kind === "noAccess") return showNoAccess(result.email)
        opts.ok(result || {})
      })
      .withFailureHandler((error) => {
        done()
        opts.fail({ offline: isOffline(error) })
      })[name](arg)
  }
  function slowSlot() {
    return h("p", { class: "small", "aria-live": "polite" })
  }
  function errorSlot(id) {
    return h("p", { class: "errore", id, "aria-live": "polite" })
  }

  // --- Lo schermo
  function show(nodes, focus) {
    $main.replaceChildren(...nodes.flat(Infinity).filter(Boolean))
    $piede.hidden = !state.view || !$piede.childElementCount
    $sei.hidden = true
    window.scrollTo(0, 0)
    if (focus) {
      const target = focus === true ? $main.querySelector("h1") : focus
      if (!/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)) target.setAttribute("tabindex", "-1")
      target.focus()
    }
  }
  function back(onclick) {
    return h("button", { type: "button", class: "indietro", onclick }, "‹ Indietro")
  }
  function tabs(current) {
    if (!state.view || !state.view.todayForSecretary) return null
    const tab = (name, label, open, extra) =>
      h("button", { type: "button", "aria-current": current === name ? "page" : null, onclick: () => open(true) }, label, extra)
    // Le condivisioni fuori dall'elenco si vedono anche da Soci: parola e forma, non solo il colore.
    const n = state.view.todayForSecretary.sharing.length
    // Su una riga sua, sotto «Oggi»: il punto lo legge solo il lettore di schermo, così a capo non resta appeso.
    const todo = n ? [h("span", { class: "vh" }, " · "), stato("span", "warn", "tri", n + " da guardare")] : null
    return h("nav", { class: "sezioni", "aria-label": "Sezioni della segreteria" }, tab("soci", "Soci", showSoci), tab("oggi", "Oggi", showOggi, todo))
  }
  // «Sei [nome] · Cambia» e «Registri come [nome] · Cambia»: il punto va col tasto, così a capo non resta appeso al nome.
  function changeWho(onclick) {
    return h("span", { class: "cambia" }, h("span", { "aria-hidden": "true" }, "·"), h("button", { type: "button", class: "collegamento", onclick }, "Cambia"))
  }
  // Sull'account condiviso, sotto il marchio di Soci e di Oggi.
  function showSei(then) {
    const names = state.view.names
    if (names.length < 2) return
    $sei.replaceChildren("Sei " + state.person, changeWho(() => showWho(names, then, then)))
    $sei.hidden = false
  }
  function dati(rows) {
    return h("dl", { class: "dati" }, rows.map(([term, value]) => [h("dt", null, term), h("dd", null, value)]))
  }

  function setView(view) {
    state.view = view
    state.person = view.person
    state.keys = view.members.map((m) => norm(m.lastName + " " + m.firstName + " " + m.number))
    state.soci = null
    const url = /^https:\/\//.test(view.instructionsUrl) ? view.instructionsUrl : ""
    $piede.replaceChildren(...(url ? [h("a", { href: url, target: "_blank", rel: "noopener" }, "Istruzioni della segreteria")] : []))
  }
  function matches(index, query) {
    return query.every((t) => state.keys[index].includes(t))
  }

  // --- L'apertura
  function showLoading() {
    show([h("h1", null, "Segreteria"), h("p", { class: "sub", role: "status" }, "Sto aprendo la segreteria…"), h("div", { class: "scheletro", "aria-hidden": "true" }, h("i"), h("i"), h("i"))])
  }
  function open(then) {
    call("officeOpen", state.person, {
      ok: (r) => {
        if (r.kind === "whoAreYou") return showWho(r.names, then)
        if (r.kind !== "ok") return showOpenError(r.message || "La segreteria non si è aperta. Tocca «Riprova».", then)
        setView(r.view)
        if (then) then()
        else showSoci(false)
      },
      fail: (e) => showOpenError(e.offline ? OFFLINE : "La segreteria non si è aperta: Google non ha risposto. Tocca «Riprova».", then),
    })
  }
  function showOpenError(message, then) {
    const retry = h("button", { type: "button", class: "btn", onclick: () => { showLoading(); open(then) } }, "Riprova")
    show([h("h1", null, "Segreteria"), stato("p", "bad", "tri", message), retry, h("p", { class: "small" }, "Se non si apre nemmeno al secondo tentativo, scrivi a " + KEEPER + ".")], true)
  }
  function showNoAccess(email) {
    state.view = null
    state.draft = null
    show([h("h1", null, "Non hai accesso a quest'area."), h("p", null, noAccessText(email || ""))], true)
  }
  function showWho(names, then, onBack) {
    const choose = (name) => () => {
      savePerson(name)
      state.person = name
      showLoading()
      open(then)
    }
    show([
      onBack ? back(onBack) : null,
      h("h1", null, "Chi sei?"),
      h("p", { class: "sub" }, "L'account è condiviso: il tuo nome va in «registrato da».", h("span", { class: "small sotto" }, "Me lo ricordo su questo telefono. Se non ci riesco, te lo chiedo di nuovo.")),
      names.map((name) => h("button", { type: "button", class: "btn sec", onclick: choose(name) }, name)),
    ], true)
  }

  // --- Soci: l'elenco si costruisce una volta per vista; la ricerca e i filtri accendono e spengono le righe.
  function buildSoci() {
    const v = state.view
    const items = v.members.map((m) => h("li", null,
      h("button", { type: "button", class: "socio", "data-numero": m.number, onclick: () => showMember(m.number) },
        h("span", { class: "socio-testa" }, h("span", { class: "socio-nome" }, fullName(m) + " · n. " + m.number), memberStato(m)),
        h("span", { class: "socio-dati" }, lastQuota(m)))))
    const count = (status) => v.members.filter((m) => m.status === status).length
    const filters = [["all", "Tutti", v.members.length], ["inGoodStanding", "In regola", count("inGoodStanding")], ["dueForRenewal", "Da rinnovare", count("dueForRenewal")]]
    const empty = h("p", { hidden: true })
    const found = h("p", { class: "vh", "aria-live": "polite" })
    const search = h("input", { type: "search", id: "cerca", autocomplete: "off", enterkeyhint: "search", "aria-describedby": "cerca-aiuto", value: state.query })
    const chips = filters.map(([filter, label, n]) => {
      const chip = h("button", { type: "button", "aria-pressed": String(state.filter === filter) }, label + " (" + n + ")")
      chip.addEventListener("click", () => {
        state.filter = filter
        for (const other of chips) other.setAttribute("aria-pressed", String(other === chip))
        apply()
      })
      return chip
    })
    function apply() {
      const query = tokens(state.query)
      let shown = 0
      items.forEach((li, i) => {
        const visible = (state.filter === "all" || v.members[i].status === state.filter) && matches(i, query)
        li.hidden = !visible
        if (visible) shown++
      })
      const text = state.query.trim()
      empty.hidden = shown > 0
      const filter = filters.find((f) => f[0] === state.filter)
      empty.textContent = emptySearchText(text, state.filter === "all" || !filter ? "" : filter[1])
      found.textContent = shown === 1 ? "1 socio" : shown + " soci"
    }
    search.addEventListener("input", () => { state.query = search.value; apply() })
    const c = v.counts
    const number = (n, color, label) => h("div", { class: "card" }, h("b", { class: color }, String(n)), label)
    const nodes = [
      h("h1", null, "Soci"),
      h("div", { class: "numeri" },
        number(c.inGoodStanding, "ok", "In regola"),
        number(c.dueForRenewal, "warn", "Da rinnovare"),
        number(c.notInGoodStanding, "bad", "Non in regola"),
        number(c.paidAhead, "ok", "Già in regola per il " + (v.year + 1))),
      h("p", { class: "totale" }, "Soci non receduti: " + c.members + " · receduti: " + c.left),
      h("p", { class: "small" }, "Chi è in regola si calcola dai pagamenti registrati: nessuno lo scrive a mano."),
      h("button", { type: "button", class: "btn", onclick: () => startDraft(null, () => showSoci(true)) }, "Registra un pagamento"),
      h("div", { class: "campo" },
        h("label", { for: "cerca" }, "Cerca un socio"),
        h("p", { class: "hint", id: "cerca-aiuto" }, "Per cognome, nome o numero socio"),
        search),
      h("div", { class: "filtri", role: "group", "aria-label": "Quali soci" }, chips),
      found,
      h("ul", { class: "elenco" }, items),
      empty,
    ]
    apply()
    return nodes
  }
  function showSoci(focus) {
    if (!state.soci) state.soci = buildSoci()
    show([tabs("soci"), ...state.soci], focus)
    showSei(() => showSoci(true))
  }

  // --- La scheda del socio
  function showMember(number, message) {
    const v = state.view
    const m = v.members.find((x) => x.number === number)
    if (!m) return showSoci(true)
    const type = { producer: "Professionista", supporter: "Sostenitore" }[m.type] || "Non indicato"
    const rows = [["Numero", m.number], ["Mail", m.email || "Nessuna"], ["Telefono", m.phone || "Nessuno"], ["Tipo", type], ["Ammesso il", dmy(m.admittedOn) || "Non indicato"]]
    if (m.leftOn) rows.push(["Receduto il", dmy(m.leftOn)])
    const note = h("p", { class: "stato ok", role: "status" }, message ? [h("span", { class: "dot pieno", "aria-hidden": "true" }), message] : null)
    show([
      back(() => {
        showSoci(false)
        const card = $main.querySelector('[data-numero="' + CSS.escape(number) + '"]')
        if (card) { card.scrollIntoView({ block: "center" }); card.focus() }
      }),
      h("h1", null, fullName(m)),
      memberStato(m, "p"),
      dati(rows),
      message ? note : null,
      h("button", { type: "button", class: "btn", onclick: () => startDraft(m, () => showMember(number)) }, "Registra un pagamento per " + m.firstName),
      h("h2", null, "Pagamenti"),
      m.payments.length ? m.payments.map((p) => paymentCard(p, m)) : h("p", null, "Nessun pagamento registrato."),
    ], message ? note : true)
  }
  function paymentCard(p, m) {
    const id = "pagamento-" + p.id
    const rows = [["Vale per", "il " + p.validYear], ["Importo", euro(p.amount)], ["Data", dmy(p.date) || "Senza data"], ["Modo", METHOD_NAME[p.method] || p.method]]
    if (p.method === "transfer") rows.push(["Riferimento", p.reference || "Nessuno"])
    if (p.method === "cash") rows.push(["Chi incassa", p.collectedBy || "Non indicato"])
    const by = p.recordedBy ? "Registrato da " + p.recordedBy + (p.recordedOn ? " il " + dmy(p.recordedOn) : "") : p.recordedOn ? "Registrato il " + dmy(p.recordedOn) : ""
    const canAct = state.view.canRecord && p.status !== "cancelled"
    return h("article", { class: "card", "aria-labelledby": id },
      h("h3", { id }, p.id),
      p.status === "cancelled" ? stato("p", "muto", "linea", "Annullato") : null,
      p.status === "pendingTreasurer" ? stato("p", "warn", "dot mezzo", "In attesa del tesoriere") : null,
      dati(rows),
      by ? h("p", { class: "small" }, by) : null,
      p.note ? h("p", { class: "nota" }, p.note) : null,
      canAct ? h("div", { class: "azioni" },
        h("button", { type: "button", class: "btn mini sec", "aria-describedby": id, onclick: () => showCancel(m, p) }, "Annulla il pagamento"),
        h("button", { type: "button", class: "btn mini sec", "aria-describedby": id, onclick: () => showChangeYear(m, p) }, "Cambia l'anno")) : null)
  }
  function paymentLine(p, m) {
    return p.id + " · " + fullName(m) + " · " + euro(p.amount) + " per il " + p.validYear + (p.date ? " · " + METHOD[p.method] + " del " + dmy(p.date) : "")
  }
  function reasonField(err) {
    return h("textarea", { id: "motivo", rows: "3", required: true, "aria-describedby": err.id })
  }
  function fieldError(err, input, message) {
    err.textContent = message
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus() }
  }
  // L'esito di «Annulla» e di «Cambia l'anno»: la vista si aggiorna e si torna alla scheda.
  function changed(m, inputs, general, message) {
    return (r) => {
      if (r.kind === "done") { setView(r.view); return showMember(m.number, message(r)) }
      if (r.kind === "invalid" && inputs[r.field]) return fieldError(inputs[r.field][1], inputs[r.field][0], r.message)
      fieldError(general, null, r.message || "Non è andata: riprova fra un momento.")
    }
  }
  function changeFailed(general, what) {
    return (e) => fieldError(general, null, e.offline ? OFFLINE : "Non siamo sicuri che sia stato " + what + ". Riprova: se è già fatto, non cambia niente.")
  }
  function showCancel(m, p) {
    const err = errorSlot("errore-motivo")
    const general = errorSlot("errore-generale")
    const reason = reasonField(err)
    const slot = slowSlot()
    const button = h("button", { type: "submit", class: "btn" }, "Sì, annulla questo pagamento")
    const form = h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault()
      err.textContent = general.textContent = ""
      const text = reason.value.trim()
      if (!text) return fieldError(err, reason, "Scrivi il motivo: resta nel registro accanto al pagamento.")
      call("officeCancelPayment", { person: state.person, paymentId: p.id, reason: text }, {
        button, slot,
        ok: changed(m, { reason: [reason, err] }, general, () => "Pagamento " + p.id + " annullato."),
        fail: changeFailed(general, "annullato"),
      })
    } },
      h("div", { class: "campo" }, h("label", { for: "motivo" }, "Motivo (obbligatorio)"), reason, err),
      general, button, slot,
      h("button", { type: "button", class: "btn sec", onclick: () => showMember(m.number) }, "No, torna alla scheda"))
    show([back(() => showMember(m.number)), h("h1", null, "Vuoi annullare questo pagamento?"), h("p", null, paymentLine(p, m)), h("p", { class: "small" }, "Resta nel registro, segnato come annullato, e non conta più."), form], true)
  }
  function showChangeYear(m, p) {
    const v = state.view
    const years = []
    for (let y = v.year - 1; y <= v.year + 2; y++) years.push(y)
    if (!years.includes(p.validYear)) years.unshift(p.validYear)
    const errYear = errorSlot("errore-anno")
    const err = errorSlot("errore-motivo")
    const general = errorSlot("errore-generale")
    const year = h("select", { id: "anno", "aria-describedby": errYear.id }, years.map((y) => h("option", { value: y, selected: y === p.validYear }, String(y))))
    const reason = reasonField(err)
    const slot = slowSlot()
    const button = h("button", { type: "submit", class: "btn" }, "Cambia l'anno")
    const form = h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault()
      errYear.textContent = err.textContent = general.textContent = ""
      const chosen = Number(year.value)
      if (chosen === p.validYear) return fieldError(errYear, year, "Scegli un anno diverso dal " + p.validYear + ".")
      const text = reason.value.trim()
      if (!text) return fieldError(err, reason, "Scrivi il motivo: resta nel registro accanto al pagamento.")
      call("officeChangeYear", { person: state.person, paymentId: p.id, validYear: chosen, reason: text }, {
        button, slot,
        ok: changed(m, { reason: [reason, err], validYear: [year, errYear] }, general, () => "Ora il pagamento " + p.id + " vale per il " + chosen + "."),
        fail: changeFailed(general, "cambiato"),
      })
    } },
      h("div", { class: "campo" }, h("label", { for: "anno" }, "Vale per l'anno"), year, errYear),
      h("div", { class: "campo" }, h("label", { for: "motivo" }, "Motivo (obbligatorio)"), reason, err),
      general, button, slot)
    show([back(() => showMember(m.number)), h("h1", null, "Cambia l'anno"), h("p", null, paymentLine(p, m)), form], true)
  }

  // --- Registra un pagamento: una schermata, sei campi. Ciò che si scrive resta in «draft» finché non è registrato.
  function startDraft(member, onBack) {
    const v = state.view
    state.draft = {
      requestKey: "",
      keyFor: "",
      member: member ? { number: member.number, name: fullName(member) } : null,
      noMember: false,
      search: "",
      amount: String(v.amount),
      method: "transfer",
      date: v.today,
      reference: "",
      collectedBy: v.person,
      note: "",
      back: onBack,
    }
    showForm()
  }
  // La chiave vale per i dati della bozza: «Riprova» con gli stessi dati non duplica; dati cambiati sono un pagamento
  // nuovo, che se il primo è entrato si ferma al possibile doppione. Con la stessa chiave il motore non li accetta.
  function paymentInput(d) {
    const input = {
      requestKey: "",
      person: state.person,
      memberNumber: d.member ? d.member.number : "",
      amount: d.amount.trim(),
      method: d.method,
      date: d.date,
      reference: d.method === "transfer" ? d.reference.trim() : "",
      collectedBy: d.method === "cash" ? d.collectedBy.trim() : "",
      note: d.note.trim(),
      notADuplicate: false,
    }
    const data = JSON.stringify(input)
    if (data !== d.keyFor) {
      d.requestKey = newKey()
      d.keyFor = data
    }
    input.requestKey = d.requestKey
    return input
  }
  function offlinePayment(d) {
    return d.method === "cash"
      ? "Qui non c'è connessione. Scrivi una ricevuta di carta (numero socio, importo, data, chi ha incassato) e consegnala al tesoriere, che la registra."
      : "Non c'è connessione. Il pagamento non è stato registrato. Tienilo da parte e riprova."
  }
  function showForm(invalid) {
    const d = state.draft
    const v = state.view
    const errs = {}
    const err = (name) => (errs[name] = errorSlot("errore-" + name))
    const inputs = {}
    const bind = (name, input, key) => {
      inputs[name] = input
      input.addEventListener("input", () => { d[key] = input.value; input.removeAttribute("aria-invalid"); errs[name].textContent = "" })
      return input
    }
    err("member"); err("amount"); err("date"); err("reference"); err("collectedBy"); err("note"); err("payment")

    // Il socio: si cerca per cognome o numero e si sceglie; oppure «Registra senza socio».
    const socio = h("div", { class: "campo" })
    function renderSocio(focusAfter) {
      if (d.member || d.noMember) {
        const change = h("button", { type: "button", class: "btn mini sec", onclick: () => { d.member = null; d.noMember = false; renderSocio(true) } }, d.member ? "Cambia socio" : "Cambia")
        socio.replaceChildren(
          h("p", { class: "etichetta" }, "Socio"),
          h("p", { class: "scelto" }, d.member ? d.member.name + " · numero " + d.member.number : "Senza socio: va in «Da abbinare»."),
          change, errs.member)
        inputs.member = change
        if (focusAfter) change.focus()
        return
      }
      const search = h("input", { type: "search", id: "socio", autocomplete: "off", "aria-describedby": "socio-aiuto errore-member", value: d.search })
      const list = h("ul", { class: "proposte" })
      const none = h("p", { "aria-live": "polite" })
      const noMember = h("button", { type: "button", class: "btn mini sec", hidden: true, onclick: () => { d.noMember = true; errs.member.textContent = ""; renderSocio(true) } }, "Registra senza socio")
      const update = () => {
        const query = tokens(d.search)
        const found = query.length ? v.members.filter((m, i) => matches(i, query)).slice(0, 8) : []
        list.replaceChildren(...found.map((m) => h("li", null, h("button", { type: "button", class: "proposta", onclick: () => {
          d.member = { number: m.number, name: fullName(m) }
          d.search = ""
          errs.member.textContent = ""
          renderSocio(true)
        } }, fullName(m) + " · numero " + m.number))))
        const nobody = query.length > 0 && found.length === 0
        none.textContent = nobody ? "Nessun socio con «" + d.search.trim() + "». Prova col numero socio o solo col cognome. Se non è un socio, registra senza socio." : ""
        noMember.hidden = !nobody
      }
      search.addEventListener("input", () => { d.search = search.value; search.removeAttribute("aria-invalid"); errs.member.textContent = ""; update() })
      socio.replaceChildren(
        h("label", { for: "socio" }, "Socio"),
        h("p", { class: "hint", id: "socio-aiuto" }, "Cerca per cognome o numero socio, poi sceglilo dall'elenco."),
        search, list, none, noMember, errs.member)
      inputs.member = search
      update()
      if (focusAfter) search.focus()
    }
    renderSocio(false)

    const amount = bind("amount", h("input", { type: "text", id: "importo", inputmode: "decimal", autocomplete: "off", "aria-describedby": "errore-amount", value: d.amount }), "amount")
    const date = bind("date", h("input", { type: "date", id: "data", "aria-describedby": "data-aiuto errore-date", value: d.date }), "date")
    // La data che si sbaglia di più è quella di oggi al posto di quella della contabile.
    const dateHelp = (m) => (m === "cash" ? "Il giorno in cui hai incassato." : "Quella scritta sulla contabile, non quella di oggi.")
    const dateHint = h("p", { class: "hint", id: "data-aiuto" }, dateHelp(d.method))
    const reference = bind("reference", h("input", { type: "text", id: "riferimento", autocomplete: "off", "aria-describedby": "riferimento-aiuto errore-reference", value: d.reference }), "reference")
    const collectedBy = bind("collectedBy", h("input", { type: "text", id: "incassa", autocomplete: "off", "aria-describedby": "incassa-aiuto errore-collectedBy", value: d.collectedBy }), "collectedBy")
    const note = bind("note", h("textarea", { id: "note", rows: "2", "aria-describedby": "errore-note" }, d.note), "note")
    const referenceBox = h("div", { class: "campo", hidden: d.method !== "transfer" },
      h("label", { for: "riferimento" }, "Riferimento del bonifico"), h("p", { class: "hint", id: "riferimento-aiuto" }, "ad esempio 8841"), reference, errs.reference)
    const cashBox = h("div", { class: "campo", hidden: d.method !== "cash" },
      h("label", { for: "incassa" }, "Chi incassa"),
      h("p", { class: "hint", id: "incassa-aiuto" }, "Contanti a un raduno: chi incassa e non è della segreteria scrive una ricevuta di carta (numero socio, importo, data, chi ha incassato) e la dà al tesoriere, che la registra."),
      collectedBy, errs.collectedBy)
    const method = (value, label) => h("label", { class: "scelta" },
      h("input", { type: "radio", name: "metodo", value, checked: d.method === value, onchange: () => {
        d.method = value
        referenceBox.hidden = value !== "transfer"
        cashBox.hidden = value !== "cash"
        dateHint.textContent = dateHelp(value)
        errs.payment.textContent = ""
      } }), label)

    const slot = slowSlot()
    const button = h("button", { type: "submit", class: "btn" }, "Continua")
    const setError = (field, message) => {
      const name = errs[field] && field !== "payment" ? field : "payment"
      fieldError(errs[name], name === "payment" ? null : inputs[name], message)
    }
    const form = h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault()
      for (const name in errs) errs[name].textContent = ""
      if (!d.member && !d.noMember) return setError("member", "Scegli il socio dall'elenco: cerca per cognome o numero socio. Se non è un socio, registra senza socio.")
      call("officePreview", paymentInput(d), {
        button, slot,
        ok: (r) => {
          if (r.kind === "preview") return showSummary(r)
          if (r.kind === "invalid") return setError(r.field, r.message)
          setError("payment", r.message || "Non è andata: riprova fra un momento.")
        },
        fail: (e) => setError("payment", e.offline ? offlinePayment(d) : "Google non ha risposto: non è stato registrato niente. Tocca di nuovo «Continua»."),
      })
    } },
      socio,
      h("div", { class: "campo" }, h("label", { for: "importo" }, "Importo"), h("div", { class: "euro" }, amount, h("span", { "aria-hidden": "true" }, "€")), errs.amount),
      h("fieldset", { class: "scelte" }, h("legend", null, "Come ha pagato"), method("transfer", "Bonifico"), method("cash", "Contanti")),
      h("div", { class: "campo" }, h("label", { for: "data" }, "Data"), dateHint, date, errs.date),
      referenceBox,
      cashBox,
      h("div", { class: "campo" }, h("label", { for: "note" }, "Note (facoltativa)"), note, errs.note),
      errs.payment, button, slot)
    show([back(() => { state.draft = null; d.back() }), h("h1", null, "Registra un pagamento"), form], true)
    if (invalid) setError(invalid.field, invalid.message)
  }

  // --- Il riepilogo, prima di salvare: al socio parte una mail.
  function showSummary(pv) {
    const d = state.draft
    const amount = euro(d.amount)
    const how = d.method === "transfer"
      ? "bonifico del " + dm(d.date) + (d.reference.trim() ? ", rif. " + d.reference.trim() : "")
      : "contanti del " + dm(d.date) + ", incassati da " + d.collectedBy.trim()
    let text
    if (!d.member) text = "Stai per registrare " + amount + " senza socio, " + how + ". Va in «Da abbinare»."
    else {
      text = "Stai per registrare " + amount + " da " + (pv.memberName || d.member.name) + ", " + how + ". Vale per il " + pv.validYear + ". "
      text += pv.pending ? "Il pagamento va in attesa del tesoriere: conta quando lo conferma." : pv.hasEmail ? "Al socio arriva una mail." : "Il socio non ha una mail: non parte niente."
    }
    const mail = !!d.member && !pv.pending && pv.hasEmail
    const general = errorSlot("errore-generale")
    const slot = slowSlot()
    const button = h("button", { type: "button", class: "btn", onclick: () => {
      general.textContent = ""
      record(paymentInput(d), button, slot, general, (field, message) => showForm({ field, message }))
    } }, mail ? "Registra e manda la mail" : "Registra")
    const names = state.view.names
    // Il nome va in «registrato da»: si legge prima di toccare «Registra».
    const as = names.length > 1 ? h("p", { class: "chi" }, "Registri come " + state.person, changeWho(() => showWho(names, () => {
      if (d.collectedBy === d.person) d.collectedBy = state.person
      showForm()
    }, () => showSummary(pv)))) : null
    show([
      h("h1", null, "Prima di registrare"),
      h("p", null, text),
      d.member && pv.leftOn ? stato("p", "warn", "tri", (pv.memberName || d.member.name) + " ha lasciato RAMI il " + dmy(pv.leftOn) + ".") : null,
      as,
      general, button, slot,
      h("button", { type: "button", class: "btn sec", onclick: () => showForm() }, "Torna indietro"),
    ], true)
    d.person = state.person
  }
  function record(input, button, slot, general, invalidField) {
    const d = state.draft
    call("officeRecordPayment", input, {
      button, slot, wait: "Sto registrando…",
      ok: (r) => {
        if (r.kind === "recorded") { setView(r.view); state.draft = null; return showOutcome(r) }
        if (r.kind === "duplicate") return showDuplicate(r)
        if (r.kind === "invalid") return invalidField(r.field, r.message)
        fieldError(general, null, r.message || NOT_SAVED)
      },
      fail: (e) => {
        fieldError(general, null, e.offline ? offlinePayment(d) : NOT_SAVED)
        button.textContent = "Riprova"
      },
    })
  }
  function showOutcome(r) {
    const [text, color, shape] = outcomeLine(r)
    const line = stato("p", color, shape, text)
    const member = r.view.members.find((m) => m.number === r.payment.memberNumber)
    const sent = member && member.email ? h("p", null, "Ho mandato la ricevuta a " + member.email + ".") : null
    const mail = { sent, noEmail: h("p", null, "Il socio non ha una mail: diglielo tu."), failed: stato("p", "bad", "tri", "La mail non è partita: avvisalo tu.") }[r.mail]
    show([
      h("h1", null, "Pagamento registrato"),
      line,
      mail,
      h("button", { type: "button", class: "btn", onclick: () => startDraft(null, () => showSoci(true)) }, "Registra un altro"),
      h("button", { type: "button", class: "btn sec", onclick: () => showSoci(true) }, "Torna ai soci"),
    ], true)
  }

  // --- Il possibile doppione: si ferma qui, e «È un altro pagamento» chiede una nota.
  function showDuplicate(r) {
    const d = state.draft
    const ex = r.existing
    const when = ex.recordedOn ? " il " + dm(ex.recordedOn) : ""
    const what = ex.method === "transfer" && ex.reference ? euro(ex.amount) + ", rif. " + ex.reference : euro(ex.amount) + " per il " + ex.validYear
    const text = "Questo pagamento sembra già registrato: " + r.memberName + ", " + what + ", registrato " + r.recordedByText + when + ". Non lo registro due volte."
    const leave = (cls) => h("button", { type: "button", class: cls, onclick: () => { state.draft = null; showSoci(true) } }, "Non registrare")
    const another = () => {
      const key = newKey()
      const err = errorSlot("errore-note")
      const general = errorSlot("errore-generale")
      const note = h("textarea", { id: "nota", rows: "2", "aria-describedby": "nota-aiuto errore-note" })
      const slot = slowSlot()
      const button = h("button", { type: "submit", class: "btn" }, "Registra")
      const form = h("form", { novalidate: true, onsubmit: (e) => {
        e.preventDefault()
        err.textContent = general.textContent = ""
        const text = note.value.trim()
        if (!text) return fieldError(err, note, "Scrivi una nota: perché è un altro pagamento.")
        const input = Object.assign(paymentInput(d), { requestKey: key, note: [d.note.trim(), text].filter(Boolean).join("\n"), notADuplicate: true })
        record(input, button, slot, general, (field, message) => (field === "note" ? fieldError(err, note, message) : showForm({ field, message })))
      } },
        h("p", null, "Lo registro per il " + r.yearIfAnother + "."),
        h("div", { class: "campo" }, h("label", { for: "nota" }, "Nota (obbligatoria)"), h("p", { class: "hint", id: "nota-aiuto" }, "ad esempio «quota di due anni»"), note, err),
        general, button, slot)
      show([h("h1", null, "Possibile doppione"), h("p", null, text), form, leave("btn sec")], note)
    }
    show([
      h("h1", null, "Possibile doppione"),
      h("p", { class: "avviso" }, h("strong", null, "Possibile doppione."), " " + text),
      leave("btn"),
      h("button", { type: "button", class: "btn sec", onclick: another }, "È un altro pagamento"),
    ], true)
  }

  // --- Oggi, per il segretario: i cambi in «Accessi» e le condivisioni fuori dall'elenco.
  function showOggi(focus) {
    const t = state.view.todayForSecretary
    if (!t) return showSoci(focus)
    const changes = t.accessChanges.length
      ? h("div", { class: "card" }, t.accessChanges.map((c) => h("p", { class: "riga" }, accessChangeText(c))))
      : h("p", null, "Nessun cambio negli ultimi 30 giorni.")
    const warning = sharingWarning(t.sharingCheckedOn, state.view.today)
    let sharing = null
    if (t.sharing.length) sharing = [
      h("div", { class: "card" }, t.sharing.map((s) => h("div", { class: "riga" },
        h("p", { class: "etichetta" }, capital(s.where)),
        h("p", null, s.account),
        stato("p", "bad", "tri", s.access === "modifica" ? "Fuori dall'elenco, può modificare" : "Fuori dall'elenco, può leggere"),
        h("p", null, revokeAdvice(s))))),
      h("p", { class: "small" }, "Ultimo controllo: " + dmy(t.sharingCheckedOn) + "."),
    ]
    else if (t.sharingCheckedOn) sharing = h("p", null, "Nessuna condivisione fuori dall'elenco. Ultimo controllo: " + dmy(t.sharingCheckedOn) + ".")
    show([
      tabs("oggi"),
      h("h1", null, "Oggi"),
      h("h2", null, "Cambi in «Accessi» negli ultimi 30 giorni"),
      changes,
      h("h2", null, "Condivisioni fuori dall'elenco"),
      warning ? stato("p", "warn", "tri", warning) : null,
      sharing,
    ], focus)
    showSei(() => showOggi(true))
  }

  open()
})()
`

/** La pagina intera. Il motore la passa a HtmlService con titolo e riga viewport (HtmlService toglie i meta tag). */
export function officePageHtml(): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Segreteria · Bussola</title>
<style>${CSS}</style>
</head>
<body>
<header class="testata"><p class="marchio"><svg ${ICON}><circle cx="12" cy="12" r="10"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor"/></svg>Bussola · RAMI</p><p id="sei" class="sei" hidden></p></header>
<div class="stanza"><svg ${ICON}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>Solo segretario, segreteria part-time e tesoriere</div>
<main id="main">
<h1>Segreteria</h1>
<p class="sub" role="status">Sto aprendo la segreteria…</p>
<div class="scheletro" aria-hidden="true"><i></i><i></i><i></i></div>
</main>
<footer id="piede" class="piede" hidden></footer>
<script>${SCRIPT}</script>
</body>
</html>
`
}
