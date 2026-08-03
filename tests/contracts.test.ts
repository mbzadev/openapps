import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const openapi = JSON.parse(readFileSync(resolve(root, 'packages/contracts/openapi.json'), 'utf8')) as { paths: Record<string, Record<string, unknown>> }

describe('public contract', () => {
  it('publishes all 40 compatible path templates', () => expect(Object.keys(openapi.paths)).toHaveLength(40))
  it.each(['/auth/register', '/apps/{platform}/{externalId}', '/charts', '/publishers/{platform}/{externalId}/import'])('contains %s', (path) => expect(openapi.paths[path]).toBeDefined())
  it('declares secure browser cookie and bearer schemes', () => {
    const text = JSON.stringify(openapi)
    expect(text).toContain('__Host-openapps-session')
    expect(text).toContain('bearerAuth')
  })
})

describe('MCP surface', () => {
  const remote = readFileSync(resolve(root, 'workers/web/src/mcp.ts'), 'utf8')
  const stdioFiles = readdirSync(resolve(root, 'mcp/src/tools')).filter((file) => file.endsWith('.ts'))
  const stdio = stdioFiles.map((file) => readFileSync(resolve(root, 'mcp/src/tools', file), 'utf8')).join('\n')
  const names = [...remote.matchAll(/name: '([^']+)'/g)].map((match) => match[1]).filter((name) => name.includes('_'))
  it('exposes exactly 29 unique remote tools', () => { expect(names).toHaveLength(29); expect(new Set(names).size).toBe(29) })
  it('keeps every stdio tool on the remote server', () => {
    const localNames = [...stdio.matchAll(/registerTool\(\s*['"]([^'"]+)/g)].map((match) => match[1])
    expect(localNames).toHaveLength(29)
    expect(new Set(names)).toEqual(new Set(localNames))
  })
  it('keeps exactly four write tools', () => expect((remote.match(/write: true/g) ?? [])).toHaveLength(4))
})

describe('native runtime boundary', () => {
  it.each(['server', 'scraper-android', 'scraper-ios', 'docker-compose.yml', 'docker-compose.production.yml'])('removes %s', (path) => expect(existsSync(resolve(root, path))).toBe(false))
  it('contains no tracked legacy runtime source', () => {
    const excluded = new Set(['node_modules', '.git', 'dist'])
    const found: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { if (excluded.has(name)) continue; const path = resolve(dir, name); if (statSync(path).isDirectory()) walk(path); else if (['.php', '.py'].includes(extname(path)) || name === 'Dockerfile') found.push(path) } }
    walk(root)
    expect(found).toEqual([])
  })
})
