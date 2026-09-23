/**
 * Typechecks every workspace package that actually has TypeScript sources.
 *
 * `tsc -p <pkg>` exits with TS18003 ("No inputs were found") when a package
 * is still empty, which is true of apps/api and packages/shared until steps
 * A2 and A3 land. That is not a type error, so it must not fail the gate --
 * but a package WITH sources must still be checked strictly.
 */
import { Glob } from 'bun'

/**
 * Each package with the glob that finds its sources.
 *
 * apps/web is app-router shaped -- `app/` and `lib/` at the root, .tsx as
 * well as .ts -- so it cannot share the `src/**` glob the others use.
 */
const PACKAGES = [
  { path: 'apps/api', sources: 'src/**/*.ts' },
  { path: 'packages/shared', sources: 'src/**/*.ts' },
  { path: 'apps/web', sources: '{app,lib,components,hooks}/**/*.{ts,tsx}' },
] as const

/**
 * Regenerate Next's route types before checking apps/web.
 *
 * `PageProps<'/patients/[id]'>` is validated against a GENERATED union of
 * every route in the file tree, written to `.next/types` and
 * `.next/dev/types`. Those are build artefacts: they are refreshed by
 * `next dev` and `next build`, so a fresh clone -- or a checkout where a
 * route was added while the dev server was not running -- typechecks
 * against a stale route list and rejects a page that is perfectly correct.
 *
 * That is exactly how this was found: adding the patient route produced
 * `Type '"/patients/[id]"' does not satisfy the constraint 'AppRoutes'`
 * while `.next/dev/types/routes.d.ts` still listed only the two older
 * routes. Generating first makes the gate depend on the source tree rather
 * than on whatever happened to run last.
 */
async function generateNextTypes(): Promise<void> {
  const proc = Bun.spawnSync(['bunx', 'next', 'typegen'], {
    cwd: 'apps/web',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (proc.exitCode === 0) {
    console.log('- apps/web: route types generated')
    return
  }

  // Not fatal on its own -- tsc will report the real consequence, and a
  // failure here with a passing tsc is not worth blocking on.
  console.log('- apps/web: could not generate route types (continuing)')
}

let failed = false

await generateNextTypes()

for (const { path: pkg, sources } of PACKAGES) {
  const glob = new Glob(sources)
  let hasSources = false
  for await (const _ of glob.scan({ cwd: pkg })) {
    hasSources = true
    break
  }

  if (!hasSources) {
    console.log(`- ${pkg}: no sources yet, skipped`)
    continue
  }

  const proc = Bun.spawnSync(['bunx', 'tsc', '-p', pkg, '--noEmit'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  if (proc.exitCode === 0) {
    console.log(`+ ${pkg}: ok`)
  } else {
    console.log(`x ${pkg}: type errors`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
