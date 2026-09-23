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

let failed = false

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
