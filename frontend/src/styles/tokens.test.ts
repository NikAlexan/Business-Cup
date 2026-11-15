import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// screens.css hand-copies the colours from tokens.json; this fails when they drift apart.
const tokens = JSON.parse(readFileSync(new URL('../../../design/design-system/tokens.json', import.meta.url), 'utf8')).color.tokens as { name: string; value: { light: string; dark: string } | string }[]
const css = readFileSync(new URL('./screens.css', import.meta.url), 'utf8')
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-f]+)/g)].map((m) => [m[1], m[2]]))
const [lightBlock, rest] = css.split('@media')
const light = vars(lightBlock)
const dark = vars(rest.split('}}')[0])

describe('colour tokens', () => {
  it('screens.css matches tokens.json in both themes', () => {
    for (const t of tokens) {
      if (typeof t.value === 'string') continue
      expect([t.name, light[t.name], dark[t.name]]).toEqual([t.name, t.value.light, t.value.dark])
    }
  })
})
