/**
 * Screenshots the landing page.
 *
 * Run: npx electron scripts/shoot-page.js
 *
 * There is no headless Chrome in this repo and no CI, but Electron ships a
 * renderer, and a page that has only ever been read as text is a page whose
 * layout has never been checked.
 *
 * CommonJS on purpose: `electron <file>.js` runs a bare file as CJS, and an
 * `import.meta` in here fails to parse before anything else gets a chance to
 * report it.
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..', '..')
const OUT = resolve(process.argv[2] || join(ROOT, '.shots'))

/* Target elements rather than ordinals: an index shifts the moment a section
   is added, and the resulting shot is of the wrong section with no error. */
const SHOTS = [
  ['01-hero', 'header.hero'],
  ['02-engines', '#engines'],
  ['03-engines-delegation', '#engines .code'],
  ['04-trace', '#trace'],
  ['05-stack', '#stack'],
  ['06-tools', '#real .tools']
]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({ width: 1440, height: 900, show: false })

  const errors = []
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(message + ' (' + source + ':' + line + ')')
  })

  // The page pulls Google Fonts. Without a network that never resolves, the
  // load event waits forever and the run looks like a hang rather than a
  // missing font — so it is given a hard ceiling.
  await Promise.race([win.loadFile(join(ROOT, 'index.html')), wait(8000)])
  await wait(1200)

  for (const [name, selector] of SHOTS) {
    /* `scroll-behavior: smooth` on the page means scrollIntoView animates, and
       capturing part-way through the animation produces a shot that looks
       like a layout bug. Go to the offset directly and say so. */
    const moved = await win.webContents.executeJavaScript(
      '(() => { const el = document.querySelector(' +
        JSON.stringify(selector) +
        '); if (!el) return "missing: ' +
        selector +
        '";' +
        ' window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: "instant"});' +
        ' return "ok" })()'
    )
    if (moved !== 'ok') process.stdout.write('[shot] ' + name + ' — ' + moved + '\n')
    await wait(500)
    writeFileSync(join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG())
    process.stdout.write('[shot] ' + name + '\n')
  }

  process.stdout.write(
    errors.length ? '\n[console] ' + errors.length + ' problem(s)\n' : '\n[console] clean\n'
  )
  for (const e of errors.slice(0, 10)) process.stdout.write('  ' + e + '\n')
  app.exit(0)
}

app.whenReady().then(main)
setTimeout(() => {
  process.stdout.write('[shot] timed out\n')
  app.exit(2)
}, 60000)
