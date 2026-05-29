/**
 * SKILLS LOADER
 * =============
 * Reads .md files from the user's Drive at:
 *   Agent Interface/Skills/shared/         ← every agent reads these
 *   Agent Interface/Skills/claude/         ← only Claude
 *   Agent Interface/Skills/gpt/            ← only ChatGPT
 *   Agent Interface/Skills/gemini/
 *   Agent Interface/Skills/grok/
 *
 * The files load on app sign-in (App.jsx) and on manual refresh (Settings →
 * Skills tab). Their content gets appended to the matching agent's system
 * prompt on every conversation — so dropping an "accountant.md" into
 * Skills/claude/ teaches Claude accounting without any app changes.
 *
 * Cap: 10,000 tokens (~40KB) per agent. If users exceed it, skills get
 * sorted by modifiedTime (newest first) and the oldest ones get marked
 * skipped:true so the UI can show what was dropped.
 */

import { logError } from './telemetry'
import { getValidDriveToken } from './driveStorage'

const ROOT_FOLDER_NAME = 'Agent Interface'
const SKILLS_FOLDER_NAME = 'Skills'
const AGENT_FOLDERS = ['shared', 'claude', 'gpt', 'gemini', 'grok']
const TOKEN_CAP_PER_AGENT = 10000

// Drive API: find a folder by name under a parent. Returns folder id or null.
async function findFolder(token, name, parentId = null) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ''
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.files?.[0]?.id || null
}

async function createFolder(token, name, parentId = null) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' }
  if (parentId) body.parents = [parentId]
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const folder = await res.json()
  return folder.id
}

async function findOrCreateFolder(token, name, parentId = null) {
  return (await findFolder(token, name, parentId)) || (await createFolder(token, name, parentId))
}

// List .md (or text/plain) files in a folder.
async function listMarkdownFiles(token, folderId) {
  if (!folderId) return []
  const q = `'${folderId}' in parents and trashed=false`
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,mimeType,size)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.files || []).filter(f => /\.md$/i.test(f.name || ''))
}

async function downloadText(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  return res.text()
}

// Strip YAML frontmatter if present, return clean body + parsed metadata.
function parseSkill(filename, modifiedTime, content) {
  let body = content
  let frontmatter = {}
  const fm = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (fm) {
    body = fm[2]
    // Very loose YAML: key: value lines. Good enough for skill metadata.
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.+)$/)
      if (m) frontmatter[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  const cleanBody = body.trim()
  return {
    name: frontmatter.name || filename.replace(/\.md$/i, ''),
    description: frontmatter.description || null,
    triggers: frontmatter.triggers ? frontmatter.triggers.split(',').map(s => s.trim()) : null,
    content: cleanBody,
    tokenEst: Math.ceil(cleanBody.length / 4),
    modifiedTime,
    filename,
  }
}

async function loadOneFolder(token, parentSkillsId, name) {
  const folderId = await findFolder(token, name, parentSkillsId)
  if (!folderId) return []

  const files = await listMarkdownFiles(token, folderId)
  // Newest first — when we hit the cap, drop the older ones.
  files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))

  const skills = []
  let totalTokens = 0
  for (const file of files) {
    const content = await downloadText(token, file.id)
    if (!content) continue
    const skill = parseSkill(file.name, file.modifiedTime, content)
    if (totalTokens + skill.tokenEst > TOKEN_CAP_PER_AGENT) {
      skill.skipped = true
    } else {
      totalTokens += skill.tokenEst
    }
    skills.push(skill)
  }
  return skills
}

/**
 * Load skills from the user's Drive into a structured object the
 * system prompt builder reads.
 *
 * Returns: { shared: [...], claude: [...], gpt: [...], gemini: [...], grok: [...] }
 * Each skill: { name, content, tokenEst, modifiedTime, filename, skipped?, triggers?, description? }
 *
 * Returns null only if Drive is not connected at all. If folders don't
 * exist yet (user hasn't set up skills), returns the structure with
 * empty arrays so the UI can show the empty state.
 */
export async function loadSkillsFromDrive() {
  try {
    const token = await getValidDriveToken()
    if (!token) return null

    const rootId = await findFolder(token, ROOT_FOLDER_NAME)
    if (!rootId) return emptyResult()
    const skillsId = await findFolder(token, SKILLS_FOLDER_NAME, rootId)
    if (!skillsId) return emptyResult()

    const [shared, claude, gpt, gemini, grok] = await Promise.all(
      AGENT_FOLDERS.map(name => loadOneFolder(token, skillsId, name))
    )
    return { shared, claude, gpt, gemini, grok }
  } catch (e) {
    logError('loadSkillsFromDrive', e)
    return null
  }
}

function emptyResult() {
  return { shared: [], claude: [], gpt: [], gemini: [], grok: [] }
}

// Starter skills dropped into Skills/shared/ on first setup so users
// see what good skills look like instead of staring at an empty folder.
// All three nudge the agents toward useful behavior without locking
// them into any one workflow — they're examples, not requirements.
const SEED_SKILLS = [
  {
    filename: 'be-direct.md',
    content: `---
name: Be Direct
description: Skip the throat-clearing — lead with the answer
---

When you respond:
- Lead with the answer in the first sentence. Save the "great question" stuff.
- If you're uncertain, say "I'm not sure, but…" — don't hedge with weasel words.
- When asked for a recommendation, pick one and defend it. Don't list five options unless asked.
- Cut filler phrases: "It's worth noting that…", "As you may know…", "Importantly…".
- If a one-line answer fits, give a one-line answer.

The user can ask follow-ups. Don't pre-emptively answer questions they didn't ask.
`,
  },
  {
    filename: 'panel-etiquette.md',
    content: `---
name: Panel Etiquette
description: How to act when other agents are also in the conversation
---

In multi-agent panels, the conversation history is tagged like \`[Claude]: …\`
and \`[Gemini]: …\` so you can tell who said what.

Rules of the room:
- If another agent already nailed the point, build on it — don't restate it.
- If you disagree, say so directly: "I'd push back on Gemini's take because…"
- Reference other agents by name when you reply to them. Makes the thread legible.
- Don't agree just to be polite. Productive disagreement is the whole point.
- Don't try to take over. The user picked a panel; play your part.
`,
  },
  {
    filename: 'project-context.md',
    content: `---
name: Project Context
description: Notes the agents should keep in mind about the user
---

Replace this file with anything you want every agent to know about you
or your work — they'll see it on every conversation.

Examples:
- "I run a small coffee roastery called Salt+Pine. My audience is wholesale buyers."
- "Default to imperial units. I'm in the US."
- "I prefer plain text over markdown headers in casual replies."
- "When you write code, use TypeScript with strict mode. No \`any\`."

The more specific you get here, the less you'll need to re-explain
yourself every conversation.
`,
  },
]

/**
 * Upload the SEED_SKILLS into Skills/shared/. Idempotent: skips any
 * file whose name already exists in that folder, so it's safe to call
 * if the user has already added their own skills.
 */
export async function seedExampleSkills() {
  try {
    const token = await getValidDriveToken()
    if (!token) return { ok: false, reason: 'no_drive' }

    const rootId = await findOrCreateFolder(token, ROOT_FOLDER_NAME)
    if (!rootId) return { ok: false, reason: 'create_root_failed' }
    const skillsId = await findOrCreateFolder(token, SKILLS_FOLDER_NAME, rootId)
    if (!skillsId) return { ok: false, reason: 'create_skills_failed' }
    const sharedId = await findOrCreateFolder(token, 'shared', skillsId)
    if (!sharedId) return { ok: false, reason: 'create_shared_failed' }

    const existing = await listMarkdownFiles(token, sharedId)
    const existingNames = new Set(existing.map(f => (f.name || '').toLowerCase()))

    let added = 0
    let skipped = 0
    for (const seed of SEED_SKILLS) {
      if (existingNames.has(seed.filename.toLowerCase())) { skipped++; continue }
      const ok = await uploadMarkdown(token, sharedId, seed.filename, seed.content)
      if (ok) added++
    }
    return { ok: true, added, skipped, folderLink: `https://drive.google.com/drive/folders/${sharedId}` }
  } catch (e) {
    logError('seedExampleSkills', e)
    return { ok: false, reason: 'exception' }
  }
}

// Multipart upload — needed because Drive's simple POST doesn't take
// a filename and parent in the same request.
async function uploadMarkdown(token, parentId, name, content) {
  const boundary = '-------skills-' + Date.now()
  const metadata = { name, mimeType: 'text/markdown', parents: [parentId] }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    content + `\r\n` +
    `--${boundary}--`
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )
  return res.ok
}

/**
 * Create Agent Interface/Skills/{shared,claude,gpt,gemini,grok} folder
 * structure in the user's Drive. Idempotent — safe to call repeatedly.
 * Used by the Settings → Skills tab to bootstrap users.
 */
export async function ensureSkillsFolders() {
  try {
    const token = await getValidDriveToken()
    if (!token) return { ok: false, reason: 'no_drive' }

    const rootId = await findOrCreateFolder(token, ROOT_FOLDER_NAME)
    if (!rootId) return { ok: false, reason: 'create_root_failed' }
    const skillsId = await findOrCreateFolder(token, SKILLS_FOLDER_NAME, rootId)
    if (!skillsId) return { ok: false, reason: 'create_skills_failed' }

    for (const name of AGENT_FOLDERS) {
      await findOrCreateFolder(token, name, skillsId)
    }
    return { ok: true, folderLink: `https://drive.google.com/drive/folders/${skillsId}` }
  } catch (e) {
    logError('ensureSkillsFolders', e)
    return { ok: false, reason: 'exception' }
  }
}
