# Bussola

La Bussola di RAMI APS, la rete agroecologica: per orientarsi nella vita dell'associazione, seguire i cantieri dei
gruppi di lavoro e tenere la segreteria.

## Com'è fatta

- **`motore/`**: due progetti Google Apps Script in TypeScript, uniti con esbuild e caricati con clasp.
  - Il motore legge i Fogli, pubblica i dati su Cloudflare KV, manda la posta e tiene la pagina della segreteria.
  - La porta di servizio riceve le azioni firmate che arrivano dal sito.
- **`sito/`**: la vetrina su Cloudflare Pages. Le pagine si compongono in una Pages Function, con Hono e JSX, dai
  dati di KV.
- **`condiviso/`**: ciò che lega i due runtime, cioè le chiavi di KV e i tipi dei dati pubblicati.
- **`copia/`**: la copia di sicurezza fuori da Google.

Niente database: i dati stanno nei Fogli di Google, e su Cloudflare va solo ciò che le pagine mostrano.

## Comandi

Serve Node nella versione di `.nvmrc`.

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run build
npm run e2e
```

`npm run e2e` scrive nel KV locale il valore del motore, unisce la vetrina e la serve con `wrangler pages dev`
su `http://localhost:8788`. In locale Cloudflare Access non c'è, e il sito non chiede il JWT.

## Licenza

MIT, vedi `LICENSE`.
