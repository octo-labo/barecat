// Session persistence: save/load conversation as events.jsonl
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface SessionEvent {
  type: 'message'
  role: 'user' | 'assistant'
  content: unknown
  timestamp: string
  model?: string
}

export interface SessionMeta {
  name: string
  model: string
  createdAt: string
  theme?: string
  startDate?: string // Day 1 date (ISO, e.g. '2026-03-20') for day counter
  lastUsage?: { input_tokens: number; output_tokens: number; totalOutput: number }
}

const BASE_DIR = join(homedir(), '.barecat', 'sessions')
const DEFAULT_SESSION = 'default'

let currentSessionName = DEFAULT_SESSION
let SESSION_DIR = join(BASE_DIR, currentSessionName)
let EVENTS_FILE = join(SESSION_DIR, 'events.jsonl')
let META_FILE = join(SESSION_DIR, 'session.json')
let WORKSPACE_DIR = join(SESSION_DIR, 'workspace')

export function setSession(name: string): void {
  currentSessionName = name
  SESSION_DIR = join(BASE_DIR, name)
  EVENTS_FILE = join(SESSION_DIR, 'events.jsonl')
  META_FILE = join(SESSION_DIR, 'session.json')
  WORKSPACE_DIR = join(SESSION_DIR, 'workspace')
}

export function getSessionName(): string {
  return currentSessionName
}

export function ensureSessionDir(): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true })
  }
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
}

export function getSessionDir(): string {
  return SESSION_DIR
}

export function getWorkspaceDir(): string {
  return WORKSPACE_DIR
}

export function listSessions(): string[] {
  if (!existsSync(BASE_DIR)) return []
  return readdirSync(BASE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

export function loadMessages(): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  if (!existsSync(EVENTS_FILE)) return []

  const lines = readFileSync(EVENTS_FILE, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  for (const line of lines) {
    try {
      const event: SessionEvent = JSON.parse(line)
      if (event.type === 'message') {
        messages.push({ role: event.role, content: event.content })
      }
    } catch {
      // skip malformed lines
    }
  }
  return messages
}

// Load timestamps parallel to messages (same index)
export function loadTimestamps(): string[] {
  if (!existsSync(EVENTS_FILE)) return []

  const lines = readFileSync(EVENTS_FILE, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)

  const timestamps: string[] = []
  for (const line of lines) {
    try {
      const event: SessionEvent = JSON.parse(line)
      if (event.type === 'message') {
        timestamps.push(event.timestamp || '')
      }
    } catch {
      timestamps.push('')
    }
  }
  return timestamps
}

export function appendEvent(event: SessionEvent): void {
  ensureSessionDir()
  appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf-8')
}

export function removeLastEvent(): void {
  if (!existsSync(EVENTS_FILE)) return
  const content = readFileSync(EVENTS_FILE, 'utf-8')
  const lines = content.split('\n')
  // Remove last non-empty line
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  if (lines.length > 0) {
    lines.pop()
  }
  writeFileSync(EVENTS_FILE, lines.join('\n') + '\n', 'utf-8')
}

export function saveMeta(meta: SessionMeta): void {
  ensureSessionDir()
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8')
}

export function loadMeta(): SessionMeta | null {
  if (!existsSync(META_FILE)) return null
  try {
    return JSON.parse(readFileSync(META_FILE, 'utf-8'))
  } catch {
    return null
  }
}

export function getEventsFilePath(): string {
  return EVENTS_FILE
}

export function countEvents(): { total: number; user: number; assistant: number } {
  if (!existsSync(EVENTS_FILE)) return { total: 0, user: 0, assistant: 0 }

  const lines = readFileSync(EVENTS_FILE, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)

  let user = 0
  let assistant = 0
  for (const line of lines) {
    try {
      const event: SessionEvent = JSON.parse(line)
      if (event.role === 'user') user++
      if (event.role === 'assistant') assistant++
    } catch { /* skip */ }
  }
  return { total: user + assistant, user, assistant }
}
