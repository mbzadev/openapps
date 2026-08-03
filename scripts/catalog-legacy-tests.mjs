import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'master', 'server/tests'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter((file) => file.endsWith('Test.php'))
const scenarios = []
for (const source of files) {
  const content = execFileSync('git', ['show', `master:${source}`], { cwd: root, encoding: 'utf8' })
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^it\('((?:\\.|[^'])*)'/)
    if (match) scenarios.push({ source: source.replace('server/tests/', ''), line: index + 1, scenario: match[1].replaceAll("\\'", "'") })
  }
}
if (scenarios.length !== 437) throw new Error(`Expected 437 legacy scenarios, found ${scenarios.length}`)
writeFileSync(resolve(root, 'tests/legacy-scenarios.json'), `${JSON.stringify(scenarios, null, 2)}\n`)
