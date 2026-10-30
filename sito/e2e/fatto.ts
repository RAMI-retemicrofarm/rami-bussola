// La definizione di fatto (docs/tappe.md), per ogni pagina che una tappa aggiunge o cambia: ciò che si misura nel
// browser. Le soglie sono quelle di «Le soglie» in docs/design/flussi-critici.md.
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export async function expectDefinitionOfDone(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'it')

  // Gli errori gravi di axe, e il testo fuori da ogni landmark: «region» axe la dà come moderata, ma chi si muove fra i
  // landmark quel testo non lo incontra mai (la fascia della Riservata ci era finita).
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(
    violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'region')
      .map((v) => ({ id: v.id, nodes: v.nodes.map((node) => node.html) })),
  ).toEqual([])

  // Testo: corpo almeno 16 px, niente sotto 13 px, interlinea del testo almeno 1,4.
  const text = await page.evaluate(() => {
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.width > 1 && box.height > 1 && !el.closest('.vh')
    }
    const withText = [...document.querySelectorAll('body *')].filter(
      (el) => visible(el) && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()),
    )
    const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize)
    const tight = [...document.querySelectorAll('main p, main dd, main dt, main li')]
      .filter(visible)
      .filter((el) => parseFloat(getComputedStyle(el).lineHeight) / size(el) < 1.4)
      .map((el) => el.textContent?.trim().slice(0, 40))
    return {
      body: size(document.body),
      smallest: Math.min(...withText.map(size)),
      tight,
    }
  })
  expect(text.body).toBeGreaterThanOrEqual(16)
  expect(text.smallest).toBeGreaterThanOrEqual(13)
  expect(text.tight).toEqual([])

  // Ogni stato ha una parola accanto alla forma.
  const mute = await page
    .locator('.stato')
    .evaluateAll((states) => states.filter((state) => !state.textContent?.trim()).map((state) => state.outerHTML))
  expect(mute).toEqual([])

  await expectTapTargets(page)
  await expectKeyboard(page)
  await expectReflow(page)
}

/**
 * I tasti: i link, i bottoni e il «summary» di un «details», che si tocca per aprirlo. Contano solo quelli che si
 * vedono: dentro un «details» chiuso i link non prendono il focus, ma Chromium dà loro lo stesso una misura, quindi la
 * larghezza non basta e serve `checkVisibility`.
 */
const TARGETS = 'a[href], button, summary'

/** Tasti di almeno 44×44 px, e almeno 8 px fra due tasti del contenuto. */
async function expectTapTargets(page: Page) {
  const boxes = await page.locator(TARGETS).evaluateAll((targets) =>
    targets
      .filter(
        (target) => !target.closest('.vh') && target.checkVisibility() && target.getBoundingClientRect().width > 0,
      )
      .map((target) => {
        const box = target.getBoundingClientRect()
        return {
          name: target.textContent?.trim().slice(0, 30) ?? '',
          inBar: !!target.closest('nav'),
          top: box.top + scrollY,
          bottom: box.bottom + scrollY,
          left: box.left,
          right: box.right,
        }
      }),
  )
  for (const box of boxes) {
    expect(box.right - box.left, `larghezza di «${box.name}»`).toBeGreaterThanOrEqual(44)
    expect(box.bottom - box.top, `altezza di «${box.name}»`).toBeGreaterThanOrEqual(44)
  }
  const content = boxes.filter((box) => !box.inBar)
  for (const [i, a] of content.entries())
    for (const b of content.slice(i + 1)) {
      const gap = Math.max(b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right)
      expect(gap, `spazio fra «${a.name}» e «${b.name}»`).toBeGreaterThanOrEqual(8)
    }
}

/**
 * Tutto raggiungibile con Tab, col focus visibile di 3 px. Safari, come WebKit qui, col Tab passa solo sui campi e
 * arriva ai link con Option+Tab, finché nelle impostazioni non si accende «Premi Tab per evidenziare ogni elemento».
 */
async function expectKeyboard(page: Page) {
  const tab = page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab'
  const targets = await page
    .locator(TARGETS)
    .evaluateAll(
      (all) => all.filter((target) => target.checkVisibility() && target.getBoundingClientRect().width > 0).length,
    )
  const reached: string[] = []
  for (let i = 0; i < targets; i++) {
    await page.keyboard.press(tab)
    const focus = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      return { name: el.textContent?.trim().slice(0, 30) ?? '', width: style.outlineWidth, style: style.outlineStyle }
    })
    expect(focus, `il tasto ${i + 1} di ${targets} prende il focus`).not.toBeNull()
    if (!focus) return
    expect(focus.style, `focus visibile su «${focus.name}»`).toBe('solid')
    expect(focus.width, `focus di 3 px su «${focus.name}»`).toBe('3px')
    reached.push(focus.name)
  }
  expect(reached).toHaveLength(targets)
}

/** A 320 px, e a 320 px con lo zoom al 200%: niente scorrimento orizzontale, nessun testo tagliato. */
async function expectReflow(page: Page) {
  const size = page.viewportSize()
  await page.setViewportSize({ width: 320, height: size?.height ?? 700 })
  for (const zoom of ['1', '2']) {
    const overflow = await page.evaluate((factor) => {
      document.documentElement.style.setProperty('zoom', factor)
      const root = document.documentElement
      const clipped = [...document.querySelectorAll('body *')]
        .filter((el) => !el.closest('.vh'))
        .filter((el) => {
          const style = getComputedStyle(el)
          return style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1
        })
        .map((el) => el.outerHTML.slice(0, 80))
      const result = { scroll: root.scrollWidth - root.clientWidth, clipped }
      document.documentElement.style.removeProperty('zoom')
      return result
    }, zoom)
    expect(overflow.scroll, `scorrimento orizzontale con lo zoom ${zoom}`).toBeLessThanOrEqual(0)
    expect(overflow.clipped, `testo tagliato con lo zoom ${zoom}`).toEqual([])
  }
  if (size) await page.setViewportSize(size)
}
