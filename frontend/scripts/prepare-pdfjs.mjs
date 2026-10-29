import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Serve the pinned worker and its original licensed resources locally, never a CDN.
const packageRoot = join(process.cwd(), 'node_modules', 'pdfjs-dist')
if (process.env.OPEN_NOTEBOOK_DIST_DIR) {
  // Next adds generated route paths to its tsconfig; keep those local to this build.
  cpSync(join(process.cwd(), 'tsconfig.json'), join(process.cwd(), 'tsconfig.local-build.json'))
}
const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
if (version !== '6.4.299') throw new Error(`Unexpected PDF.js version: ${version}`)
const target = join(process.cwd(), 'public', 'pdfjs', version)
mkdirSync(target, { recursive: true })
for (const item of ['LICENSE', 'cmaps', 'iccs', 'standard_fonts', 'wasm', 'web/images']) {
  cpSync(join(packageRoot, item), join(target, item), { recursive: true })
}
mkdirSync(join(target, 'build'), { recursive: true })
cpSync(join(packageRoot, 'build', 'pdf.worker.mjs'), join(target, 'build', 'pdf.worker.mjs'))
