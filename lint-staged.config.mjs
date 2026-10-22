// lint-staged: al commit, formatta e controlla solo i file toccati (la Bottega non formatta a ogni modifica).
// La config sta in una costante: un oggetto esportato anonimo fa scattare import/no-anonymous-default-export di
// eslint-config-next, e con --max-warnings=0 il commit si ferma. I .md restano fuori da Prettier (prettierignore).
// --no-warn-ignored: un file che ESLint ignora (i tipi generati di wrangler) darebbe un avviso, e fermerebbe il commit.
const config = {
  '*.{ts,tsx,js,jsx,mjs,cjs,mts}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{json,css,scss,yml,yaml,astro}': ['prettier --write'],
}

export default config
