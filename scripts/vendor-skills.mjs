// Copies the agent skills ONIC Studio is allowed to bundle into skills-vendor/.
// - Each source is pinned to a commit, so a repo changing upstream can't change what agents read.
// - Only Markdown is copied: skills are knowledge for the agents, never code we run.
// - The build stops if a licence isn't the permissive one we expect.
// Usage: npm run vendor-skills
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, dirname } from 'node:path'

const SOURCES = [
  {
    repo: 'higgsfield-ai/skills',
    commit: '4d0757471a704dac8729ea3c2ef0f3f330e0d9b6',
    license: { file: 'LICENSE', spdx: 'MIT' },
    skills: { 'higgsfield-generate': 'higgsfield-generate', 'higgsfield-product-photoshoot': 'higgsfield-product-photoshoot', 'higgsfield-marketplace-cards': 'higgsfield-marketplace-cards' },
  },
  {
    repo: 'anthropics/skills',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    // anthropics/skills has no root licence; each permitted skill carries its own Apache-2.0 LICENSE.txt.
    license: { file: 'LICENSE.txt', spdx: 'Apache-2.0', perSkill: true },
    skills: { 'canvas-design': 'skills/canvas-design', 'frontend-design': 'skills/frontend-design' },
  },
  {
    repo: 'charlie947/social-media-skills',
    commit: '10ca79c0ec0be0f7654d19cd4f0c86b6fa6ed23b',
    license: { file: 'LICENSE', spdx: 'MIT' },
    skills: {
      'voice-builder': 'skills/voice-builder',
      'hook-generator': 'skills/hook-generator',
      'post-scorer': 'skills/post-scorer',
      'reels-scripting': 'skills/reels-scripting',
    },
  },
  {
    repo: 'thatrebeccarae/claude-marketing',
    commit: 'a8a63ec1341f05ec9c1e9cb52b4edeb14e3bdcba',
    license: { file: 'LICENSE', spdx: 'MIT' },
    skills: { 'social-media-strategy': 'skills/social-media-strategy', 'copywriting-frameworks': 'skills/copywriting-frameworks' },
  },
  {
    repo: 'blader/humanizer',
    commit: '0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0',
    license: { file: 'LICENSE', spdx: 'MIT' },
    skills: { humanizer: '.' },
  },
]

// Each licence must contain its standard grant and must not carry riders that restrict use.
const LICENSE_MARKERS = {
  MIT: /Permission is hereby granted, free of charge, to any person obtaining a copy[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/,
  'Apache-2.0': /Apache License\s+Version 2\.0, January 2004[\s\S]*TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION[\s\S]*END OF TERMS AND CONDITIONS/,
}
const RESTRICTIVE_RIDERS = /Commons Clause|non-commercial|noncommercial|All rights reserved\.?\s*$/im

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'skills-vendor')
const work = mkdtempSync(join(tmpdir(), 'onic-skills-'))

// Symlinks are refused outright: a skill must not be able to point us at files outside itself.
const markdownFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.')) return []
    const full = join(dir, name)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed in a skill: ${full}`)
    if (stat.isDirectory()) return markdownFiles(full)
    return name.endsWith('.md') ? [full] : []
  })

const insideOf = (parent, child) => !relative(realpathSync(parent), realpathSync(child)).startsWith('..')

// A licence file inside a skill folder can override the repo's licence, so each one must pass the same check.
const extraLicenses = (dir, allowed) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => /(^|\/)(LICEN[CS]E|COPYING|NOTICE)[^/]*$/i.test(p) && p !== allowed)

const checkLicense = (path, spdx, where) => {
  if (!existsSync(path)) throw new Error(`${where}: licence file missing (${path})`)
  const text = readFileSync(path, 'utf8')
  if (!LICENSE_MARKERS[spdx].test(text)) throw new Error(`${where}: licence is not ${spdx}`)
  if (RESTRICTIVE_RIDERS.test(text)) throw new Error(`${where}: licence has a restrictive rider`)
  return text
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const notices = []

try {
  for (const src of SOURCES) {
    const dir = join(work, src.repo.replace('/', '__'))
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['-C', dir, 'fetch', '-q', '--depth', '1', `https://github.com/${src.repo}`, src.commit])
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD'])
    // GitHub serves commits from forks under the upstream URL; require the pin to be on upstream's own history.
    execFileSync('git', ['-C', dir, 'fetch', '-q', '--filter=blob:none', `https://github.com/${src.repo}`, 'HEAD'])
    try {
      execFileSync('git', ['-C', dir, 'merge-base', '--is-ancestor', src.commit, 'FETCH_HEAD'])
    } catch {
      throw new Error(`${src.repo}: ${src.commit} is not on the upstream default branch`)
    }

    for (const [name, path] of Object.entries(src.skills)) {
      const skillDir = join(dir, path)
      if (!existsSync(join(skillDir, 'SKILL.md'))) throw new Error(`${src.repo}/${path}: no SKILL.md`)
      if (!insideOf(dir, skillDir)) throw new Error(`${src.repo}/${path}: escapes the repository`)
      if (path !== '.') {
        for (const extra of extraLicenses(skillDir, src.license.perSkill ? src.license.file : '')) {
          checkLicense(join(skillDir, extra), src.license.spdx, `${src.repo}/${path}/${extra}`)
        }
      }
      const licensePath = src.license.perSkill ? join(skillDir, src.license.file) : join(dir, src.license.file)
      const licenseText = checkLicense(licensePath, src.license.spdx, `${src.repo}/${path}`)

      const files = path === '.' ? [join(skillDir, 'SKILL.md')] : markdownFiles(skillDir)
      for (const file of files) {
        const target = join(out, name, relative(skillDir, file))
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(file, target)
      }
      notices.push({ name, repo: src.repo, path, commit: src.commit, spdx: src.license.spdx, licenseText })
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

const lines = [
  '# Third-party skills bundled with ONIC Studio',
  '',
  'Generated by `npm run vendor-skills`. Only Markdown is bundled; agents read it as background knowledge.',
  '',
  '| Skill | Source | Commit | Licence |',
  '|---|---|---|---|',
  ...notices.map((n) => `| ${n.name} | https://github.com/${n.repo}/tree/${n.commit}/${n.path === '.' ? '' : n.path} | \`${n.commit.slice(0, 12)}\` | ${n.spdx} |`),
  '',
  '## Licence texts',
  '',
]
const seen = new Set()
for (const n of notices) {
  const key = `${n.repo}|${n.licenseText}`
  if (seen.has(key)) continue
  seen.add(key)
  lines.push(`### ${n.repo} (${n.spdx})`, '', '```', n.licenseText.trim(), '```', '')
}
writeFileSync(join(out, 'NOTICES.md'), lines.join('\n'))
console.log(`Vendored ${notices.length} skills into skills-vendor/.`)
