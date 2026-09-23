/**
 * Cross-runtime date-formatting parity (added after a C10 hydration bug).
 *
 * WHY A SCRIPT AND NOT A TEST. The bug was that `Intl.DateTimeFormat`
 * produced different output on Bun and Node for the same locale and
 * options:
 *
 *   Bun  (ICU 78.3): "Wednesday, 23 September 2026"
 *   Node (ICU 75.1): "Wednesday 23 September, 2026"
 *
 * Next renders on Node and hydrates against Bun-built client code, so React
 * compared the two and regenerated the tree.
 *
 * `bun test` cannot catch this, and I confirmed that: reverting the fix left
 * all eleven unit tests green, because they run on Bun where the locale
 * pattern happens to match our chosen wording. A test can only ever see one
 * runtime. This script runs the formatters on BOTH and compares -- which is
 * the only way the mismatch is visible at all.
 *
 * Skips silently when Node is unavailable, since Node is not a declared
 * dependency of this project; it is present because Next brings it.
 */

/** Dates chosen to exercise the cases that actually broke or nearly broke. */
const SAMPLES = [
  '2026-09-23T03:30:00.000Z', // 09:00 IST -- the seeded first appointment
  '2026-01-01T18:45:00.000Z', // 00:15 IST next day -- the midnight roll
  '2026-12-31T20:00:00.000Z', // 01:30 IST next YEAR
  '2026-07-04T11:00:00.000Z', // an ordinary afternoon
]

/**
 * The formatter bodies, inlined as source.
 *
 * Duplicated from lib/format.ts rather than imported, because Node cannot
 * resolve the `@emr/shared` workspace import or a `.ts` extension without a
 * loader. The duplication is checked: `assertMatchesSource` below fails if
 * the real implementation's arrangement drifts from this copy.
 */
const PROGRAM = `
const TZ = 'Asia/Kolkata'
const P = {
  time: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }),
  long: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  short: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }),
}
const partsOf = (f, d) => {
  const o = {}
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value
  return o
}
const out = ${JSON.stringify(SAMPLES)}.map((iso) => {
  const d = new Date(iso)
  const t = partsOf(P.time, d)
  const l = partsOf(P.long, d)
  const s = partsOf(P.short, d)
  return [
    (t.hour + ':' + t.minute + ' ' + (t.dayPeriod ?? '').toLowerCase()).trim(),
    l.weekday + ', ' + l.day + ' ' + l.month + ' ' + l.year,
    s.day + ' ' + s.month + ' ' + s.year,
  ]
})
console.log(JSON.stringify(out))
`

/** Confirm the inlined copy still matches how lib/format.ts assembles. */
async function assertMatchesSource(): Promise<void> {
  const source = await Bun.file('apps/web/lib/format.ts').text()

  // biome-ignore-start lint/suspicious/noTemplateCurlyInString: these are
  // literal source fragments to search lib/format.ts for, not templates to
  // interpolate -- the `${...}` is the text being matched.
  const expected = [
    "`${hour}:${minute} ${(dayPeriod ?? '').toLowerCase()}`",
    '`${weekday}, ${day} ${month} ${year}`',
    '`${day} ${month} ${year}`',
  ]
  // biome-ignore-end lint/suspicious/noTemplateCurlyInString: see above

  const missing = expected.filter((template) => !source.includes(template))
  if (missing.length > 0) {
    console.error(
      'x format parity: lib/format.ts no longer assembles the way this check assumes.',
    )
    console.error('  Missing template(s):')
    for (const template of missing) console.error(`    ${template}`)
    console.error('  Update scripts/check-format-parity.ts to match.')
    process.exit(1)
  }
}

async function run(): Promise<void> {
  await assertMatchesSource()

  const onBun = Bun.spawnSync(['bun', '-e', PROGRAM], { stdout: 'pipe' })
  const bunOut = onBun.stdout.toString().trim()

  const onNode = Bun.spawnSync(['node', '-e', PROGRAM], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (onNode.exitCode !== 0) {
    console.log('- format parity: node unavailable, skipped')
    return
  }

  const nodeOut = onNode.stdout.toString().trim()

  if (bunOut !== nodeOut) {
    console.error('x format parity: Bun and Node format dates differently.')
    console.error('  This WILL surface as a React hydration mismatch.')
    console.error(`  bun : ${bunOut}`)
    console.error(`  node: ${nodeOut}`)
    process.exit(1)
  }

  console.log('+ format parity: bun and node agree')
}

await run()
