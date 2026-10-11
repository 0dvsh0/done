import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Development only. With `DONE_SHOT` set, the app drives *itself* through a
 * real task and writes PNGs to docs/shots — the screenshots in the README,
 * taken from the real window, with a real agent behind it.
 *
 * There is nothing to fake here: the empty state is the empty state, the trace
 * is the trace the run actually produced, and the economics sheet is computed
 * from the spans that run exported. If the model is not connected the run
 * simply will not finish and the screenshots will show that instead.
 */
export async function captureSequence(getWindow: () => BrowserWindow | null): Promise<void> {
  const dir = join(app.getAppPath(), 'docs', 'shots')
  mkdirSync(dir, { recursive: true })

  const step = (name: string): void => {
    process.stdout.write(`[capture] ${name}\n`)
  }
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const w0 = getWindow()
  w0?.webContents.on('console-message', (_e, level, message, line, source) => {
    process.stdout.write(`[renderer] ${level} ${message} (${source}:${line})\n`)
  })
  w0?.webContents.on('render-process-gone', (_e, details) => {
    process.stdout.write('[renderer] gone: ' + JSON.stringify(details) + '\n')
  })
  w0?.webContents.on('preload-error', (_e, p, err) => {
    process.stdout.write('[preload] error ' + p + ' ' + String(err) + '\n')
  })

  /** Never let one stuck call take the whole run down. */
  const js = async (code: string, label: string): Promise<unknown> => {
    const w = getWindow()
    if (!w) return null
    try {
      const out = await Promise.race([
        w.webContents.executeJavaScript(code),
        new Promise((r) => setTimeout(() => r('__timeout__'), 6000))
      ])
      if (out === '__timeout__') step(`${label} timed out`)
      return out
    } catch (err) {
      step(`${label} threw: ${String(err)}`)
      return null
    }
  }

  const shot = async (name: string): Promise<void> => {
    const w = getWindow()
    if (!w) return
    const image = await w.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), image.toPNG())
    step(name)
  }

  const click = (selector: string, index = 0): Promise<unknown> =>
    js(
      `(() => { const els = document.querySelectorAll(${JSON.stringify(selector)});
        const el = els[${index}]; if (el) { el.dispatchEvent(new MouseEvent('click', {bubbles:true})); return true } return false })()`,
      `click ${selector}`
    )

  const clickText = (prefix: string): Promise<unknown> =>
    js(
      `(() => { for (const b of document.querySelectorAll('button')) {
         if ((b.textContent||'').trim().startsWith(${JSON.stringify(prefix)})) { b.click(); return true } } return false })()`,
      `clickText ${prefix}`
    )

  const type = (selector: string, value: string): Promise<unknown> =>
    js(
      `(() => {
         const el = document.querySelector(${JSON.stringify(selector)});
         if (!el) return false;
         const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
         const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
         setter.call(el, ${JSON.stringify(value)});
         el.dispatchEvent(new Event('input', {bubbles:true}));
         return true })()`,
      `type ${selector}`
    )

  const key = (k: string, mod = false): Promise<unknown> =>
    js(
      `(() => { const t = document.activeElement && document.activeElement !== document.body
          ? document.activeElement : window;
        t.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(k)}, metaKey:${mod}, bubbles:true}));
        return true })()`,
      `key ${k}`
    )

  const closeTop = (): Promise<unknown> =>
    js(
      `(() => { const btns = [...document.querySelectorAll('[data-sheet-close]')];
        const last = btns[btns.length-1]; if (last) { last.click(); return true } return false })()`,
      'closeTop'
    )

  try {
    getWindow()?.focus()
    await wait(2500)
    await shot('01-empty')

    // A real goal, run by the real agent. It does not have to finish inside the
    // capture window — these are screenshots of the app working, not a
    // choreographed sequence.
    await type('[data-composer]', 'What is the current Node.js LTS version? Search the web.')
    await wait(500)
    await shot('02-composed')

    await js(
      `(() => { const f = document.querySelector('[data-composer]')?.closest('form');
        if (f) { f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', {bubbles:true})); return true } return false })()`,
      'submit'
    )
    await wait(9000)
    await shot('03-working')

    await click('[data-row]')
    await wait(1400)
    await shot('04-detail')

    await clickText('Show what')
    await wait(900)
    await shot('05-underneath')

    await clickText('Trace')
    await wait(1200)
    await shot('06-trace')
    await closeTop()
    await wait(700)

    await key(',')
    await wait(900)
    await shot('07-limits')
    await closeTop()
    await wait(700)

    getWindow()?.webContents.send('menu:settings')
    await wait(900)
    await shot('08-connections')
    await closeTop()
    await wait(700)

    getWindow()?.webContents.send('menu:command')
    await wait(600)
    await type('input[placeholder^="Search your list"]', 'Pay per period')
    await wait(700)
    await shot('09-economics')
    await key('Escape')
    await wait(700)

    // Maximised, the way the window behaves on a real display.
    await js(`window.done.windowAction('maximize')`, 'maximize')
    await wait(1400)
    await shot('10-maximised')

    step('done')
  } catch (err) {
    step(`failed: ${String(err)}`)
  }
}
