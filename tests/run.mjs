import { spawnSync } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const temporaryDirectory = mkdtempSync(join(projectRoot, 'node_modules/.prebi-tests-'))
try {
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  const compilation = spawnSync(process.execPath, [compiler, '--ignoreConfig', 'src/ratingValidation.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--outDir', temporaryDirectory], { cwd: projectRoot, stdio: 'inherit' })
  if (compilation.status !== 0) throw new Error('Could not compile rating validation for tests.')
  const modulePath = join(temporaryDirectory, 'ratingValidation.mjs')
  renameSync(join(temporaryDirectory, 'ratingValidation.js'), modulePath)
  const reviewCompilation = spawnSync(process.execPath, [compiler, '--ignoreConfig', 'src/reviewContract.ts', '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node', '--ignoreDeprecations', '6.0', '--esModuleInterop', '--strict', '--skipLibCheck', '--outDir', temporaryDirectory], { cwd: projectRoot, stdio: 'inherit' })
  if (reviewCompilation.status !== 0) throw new Error('Could not compile review contract for tests.')
  const reviewModulePath = join(temporaryDirectory, 'reviewContract.cjs')
  renameSync(join(temporaryDirectory, 'reviewContract.js'), reviewModulePath)
  const result = spawnSync(process.execPath, ['--test', 'tests/ratingValidation.test.mjs', 'tests/reviewContract.test.mjs', 'tests/expertSession.test.mjs', 'tests/reviewSession.test.mjs'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PREBI_RATING_VALIDATION_MODULE: pathToFileURL(modulePath).href, PREBI_REVIEW_MODULE: pathToFileURL(reviewModulePath).href },
  })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}