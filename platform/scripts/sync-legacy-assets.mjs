import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const webDist = resolve(repositoryRoot, 'web/dist')
const webPublic = resolve(repositoryRoot, 'web/public')
const docsDist = resolve(repositoryRoot, 'docs-site/dist')
const platformPublic = resolve(repositoryRoot, 'platform/public')
const legacyAssets = resolve(platformPublic, 'legacy/assets')
const docsDestination = resolve(platformPublic, 'docs')

await rm(legacyAssets, { recursive: true, force: true })
await rm(docsDestination, { recursive: true, force: true })
await mkdir(resolve(platformPublic, 'legacy'), { recursive: true })
await cp(resolve(webDist, 'assets'), legacyAssets, { recursive: true, force: true })
await cp(docsDist, docsDestination, { recursive: true, force: true })

for (const entry of await readdir(webPublic, { withFileTypes: true })) {
  if (entry.name === 'config.js') continue
  await cp(resolve(webPublic, entry.name), resolve(platformPublic, entry.name), { recursive: entry.isDirectory(), force: true })
}
