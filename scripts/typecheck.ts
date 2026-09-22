/**
 * Typechecks every workspace package that actually has TypeScript sources.
 *
 * `tsc -p <pkg>` exits with TS18003 ("No inputs were found") when a package
 * is still empty, which is true of apps/api and packages/shared until steps
 * A2 and A3 land. That is not a type error, so it must not fail the gate --
 * but a package WITH sources must still be checked strictly.
 */
import { Glob } from 'bun'

const PACKAGES = ['apps/api', 'packages/shared'] as const

let failed = false

for (const pkg of PACKAGES) {
  const glob = new Glob('src/**/*.ts')
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
