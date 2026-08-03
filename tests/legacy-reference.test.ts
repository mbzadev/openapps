import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Scenario = { source: string; line: number; scenario: string }
const scenarios = JSON.parse(readFileSync(resolve(import.meta.dirname, 'legacy-scenarios.json'), 'utf8')) as Scenario[]

describe('legacy behavioral reference catalog', () => {
  it('retains all 437 Laravel scenarios as the rewrite reference', () => expect(scenarios).toHaveLength(437))
  it('retains every original test module and exact source location', () => {
    expect(new Set(scenarios.map(({ source }) => source)).size).toBe(48)
    expect(scenarios.every(({ source, line, scenario }) => source.endsWith('Test.php') && line > 0 && scenario.length > 3)).toBe(true)
  })
  it.each(['Feature/Api/', 'Feature/Connectors/', 'Feature/Jobs/', 'Feature/Regression/', 'Unit/Services/'])('covers the %s scenario family', (family) => {
    expect(scenarios.some(({ source }) => source.startsWith(family))).toBe(true)
  })
})

const proofFor = (source: string): string[] => {
  if (source.startsWith('Feature/Api/Account/') || source === 'Feature/Api/Auth/AuthTest.php' || source.startsWith('Feature/Api/Folder/')) {
    return ['tests/workers/auth-account.test.ts']
  }
  if (source.startsWith('Feature/Api/')) return ['tests/workers/api-compat.test.ts']
  if (source.startsWith('Feature/Connectors/')) return ['tests/core.test.ts']
  if (source.startsWith('Feature/Jobs/')) return ['tests/workers/queues.test.ts', 'tests/jobs.test.ts']
  if (source.startsWith('Feature/Regression/')) return ['tests/d1.test.ts', 'tests/workers/api-compat.test.ts', 'tests/workers/queues.test.ts']
  if (source.endsWith('KeywordAnalyzerTest.php')) return ['tests/core.test.ts', 'tests/workers/api-compat.test.ts']
  if (source.endsWith('StoreCategoryResolverTest.php') || source.endsWith('AppRegistrarTest.php')) return ['tests/d1.test.ts', 'tests/workers/api-compat.test.ts']
  if (source.endsWith('AppSyncerPartialTest.php')) return ['tests/d1.test.ts', 'tests/workers/queues.test.ts']
  return []
}

describe('one-to-one legacy scenario migration traceability', () => {
  it.each(scenarios)('$source:$line — $scenario', ({ source }) => {
    const proofs = proofFor(source)
    expect(proofs, `${source} has no executable TypeScript proof`).not.toHaveLength(0)
    for (const proof of proofs) {
      const path = resolve(import.meta.dirname, '..', proof)
      expect(existsSync(path), `${proof} is missing`).toBe(true)
      expect(readFileSync(path, 'utf8'), `${proof} does not contain behavioral assertions`).toMatch(/\bexpect\s*\(/)
    }
  })
})
