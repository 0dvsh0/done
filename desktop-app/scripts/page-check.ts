/**
 * Structural sanity check for the landing page.
 *
 * Not a validator — it checks the things that actually break when a page is
 * edited by hand: an unbalanced tag, an anchor that points at nothing, and
 * copy that names a provider the app no longer ships.
 *
 * Run: npx tsx scripts/page-check.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve(process.cwd(), '..', 'index.html'), 'utf8')

let failures = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

const count = (re: RegExp): number => (html.match(re) ?? []).length

ok(count(/<section\b/g) === count(/<\/section>/g), `<section> balanced (${count(/<section\b/g)})`)
ok(count(/<div\b/g) === count(/<\/div>/g), `<div> balanced (${count(/<div\b/g)})`)

/* Every in-page link must land on something that exists. */
const targets = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1])
for (const t of [...new Set(targets)]) {
  ok(new RegExp(`id="${t}"`).test(html), `#${t} has a target`)
}

/* A provider we removed must not still be advertised. */
ok(!/\broma\b/i.test(html), 'no reference to a removed provider')
ok(!/DuckDuckGo/.test(html), 'no claim about a search backend the app no longer uses')
ok(html.includes('openai/gpt-oss-120b'), 'the local model is named')

/* The engine cards must each say which model runs them. */
const engines = ['claude-sonnet-5', 'gemini-2.5-pro', 'grok-4.5', 'gpt-5.4-mini', 'api.github.com']
for (const m of engines) ok(html.includes(m), `engine card names ${m}`)

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
