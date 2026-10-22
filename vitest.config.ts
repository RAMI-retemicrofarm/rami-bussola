import { defineConfig } from 'vitest/config'

// Un giro solo per i tre pezzi: il motore gira in Node con i servizi di Google finti, la vetrina con `app.request()`.
export default defineConfig({
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
