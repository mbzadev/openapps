import { readFileSync } from 'node:fs'
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
