import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { validateMarkdownFile } from '../src/validator'

const f = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8')

describe('md-validator', () => {
  it('passes ok fixture', async () => {
    const res = await validateMarkdownFile(path.join(__dirname, '..', 'fixtures', 'ok.md'))
    expect(res.ok).toBe(true)
    expect(res.errors.length).toBe(0)
  })
  it('fails bad fixture', async () => {
    const res = await validateMarkdownFile(path.join(__dirname, '..', 'fixtures', 'bad.md'))
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
  })
})
