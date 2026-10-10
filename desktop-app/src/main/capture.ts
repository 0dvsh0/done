import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Development only. When `DONE_SHOT` is set, the app walks itself through a
 * few states and writes PNGs to docs/shots — the same screenshots that go in
 * the README, taken from the real window.
 */
export async function captureSequence(getWindow: () => BrowserWindow | null): Promise<void> {
  const dir = join(app.getAppPath(), 'docs', 'shots')
  mkdirSync(dir, { recursive: true })

  const w0 = getWindow()
  w0?.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer] ${level} ${message} (${source}:${line})`)
  })
  w0?.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] gone:', JSON.stringify(details))
  })
  w0?.webContents.on('preload-error', (_e, p, err) => {
    console.log('[preload] error', p, err)
  })

  const step = (name: string): void => {
    process.stdout.write(`[capture] ${name}\n`)
  }
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /** Never let one stuck call take the whole run down. */
  const js = async (code: string, label: string): Promise<unknown> => {
    const w = getWindow()
    if (!w) return null
    try {
      const out = await Promise.race([
        w.webContents.executeJavaScript(code),
        new Promise((r) => setTimeout(() => r('__timeout__'), 4000))
      ])
      if (out === '__timeout__') console.log(`[capture] ${label} timed out`)
      return out
    } catch (err) {
      console.log(`[capture] ${label} threw:`, err)
      return null
    }
  }

  const shot = async (name: string): Promise<void> => {
    step(name)
    const w = getWindow()
    if (!w) return
    const image = await w.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), image.toPNG())
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

  const key = (k: string, mod = false): Promise<unknown> =>
    js(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(k)}, metaKey:${mod}, bubbles:true}))`,
      `key ${k}`
    )

  const closeTop = (): Promise<unknown> =>
    js(
      `(() => { const btns = [...document.querySelectorAll('[data-sheet-close]')];
        const last = btns[btns.length-1]; if (last) { last.click(); return true } return false })()`,
      'closeTop'
    )

  try {
    await wait(Number(process.env['DONE_SHOT_WAIT'] ?? 6000))
    await shot('01-list')

    await key('k', true)
    await wait(700)
    await shot('02-command')
    await key('Escape')
    await wait(500)

    await click('[data-row]')
    await wait(1400)
    await shot('03-detail')

    await clickText('Show what')
    await wait(800)
    await shot('04-underneath')

    await clickText('Trace')
    await wait(1000)
    await shot('05-trace')
    await closeTop()
    await wait(800)

    await key(',')
    await wait(900)
    await shot('06-limits')
    await closeTop()
    await wait(700)

    await key('?')
    await wait(800)
    await shot('07-shortcuts')
    await closeTop()
    await wait(700)

    getWindow()?.webContents.send('menu:settings')
    await wait(900)
    await shot('08-connections')
    await closeTop()
    await wait(700)

    getWindow()?.webContents.send('menu:command')
    await wait(600)
    await js(
      `(() => { const i = document.querySelector('input[placeholder^="Search your list"]');
        if (!i) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, 'Pay per period');
        i.dispatchEvent(new Event('input', {bubbles:true}));
        return true })()`,
      'type economics'
    )
    await wait(700)
    await key('Enter')
    await wait(1000)
    await shot('09-economics')

    step('done')
  } catch (err) {
    step(`failed: ${String(err)}`)
  }
}