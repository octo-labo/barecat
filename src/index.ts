#!/usr/bin/env node
// barecat — zero-overhead LLM chat CLI
// No system prompt. No memory injection. No token waste. Pure context.

// Force UTF-8 output
process.stdout.setDefaultEncoding('utf-8')
if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding('utf-8')

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ContentBlockParam, ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { MarkdownRenderer } from './markdown.js'
import { getTheme, setTheme, getThemeNames } from './themes.js'
import {
  loadMessages,
  loadTimestamps,
  appendEvent,
  removeLastEvent,
  ensureSessionDir,
  saveMeta,
  loadMeta,
  getEventsFilePath,
  countEvents,
  setSession,
  getSessionName,
  getWorkspaceDir,
  listSessions,
  type SessionEvent,
} from './session.js'
import {
  estimateMessagesTokens,
  estimateTokens,
  getContextWindow,
  formatContextUsage,
} from './tokens.js'
import { toolDefinitions, executeTool, setWorkingDir } from './tools.js'

// ── Config ──────────────────────────────────────────────
const DEFAULT_MODEL = 'claude-opus-4.6'
const BASE_URL = process.env.ANTHROPIC_BASE_URL ?? 'http://localhost:4141'
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? 'sk-dummy'

// Parse model from args (skip --flags)
const modelArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
let currentModel = modelArg ?? process.env.BARECAT_MODEL ?? DEFAULT_MODEL
let thinkingEnabled = false
let thinkingBudget = 10000

// Models that support extended thinking
function isThinkingModel(model: string): boolean {
  return thinkingEnabled && (
    model.includes('opus') ||
    model.includes('sonnet-4') ||
    model.includes('haiku')
  )
}

// ── State ───────────────────────────────────────────────
let messages: MessageParam[] = []
let messageTimestamps: string[] = [] // parallel to messages, for time injection
let lastApiUsage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 }
let totalOutputTokens = 0

// ── Init ────────────────────────────────────────────────
function init(): void {
  // Parse --session argument
  const sessionArg = process.argv.find((a) => a.startsWith('--session='))
  const sessionName = sessionArg ? sessionArg.split('=')[1] : process.env.BARECAT_SESSION ?? 'default'
  setSession(sessionName)
  ensureSessionDir()
  setWorkingDir(getWorkspaceDir())

  const meta = loadMeta()
  if (meta) {
    currentModel = currentModel === DEFAULT_MODEL ? meta.model : currentModel
    if (meta.lastUsage) {
      lastApiUsage = { input_tokens: meta.lastUsage.input_tokens, output_tokens: meta.lastUsage.output_tokens }
      totalOutputTokens = meta.lastUsage.totalOutput ?? 0
    }
    if (meta.theme) {
      setTheme(meta.theme)
    }
  }

  // Resume existing session
  const loaded = loadMessages()
  messages = loaded as MessageParam[]
  messageTimestamps = loadTimestamps()

  const counts = countEvents()
  const ctxWindow = getContextWindow(currentModel)
  const usedTokens = lastApiUsage.input_tokens > 0 ? lastApiUsage.input_tokens : estimateMessagesTokens(messages)
  const ctxSource = lastApiUsage.input_tokens > 0 ? 'actual' : 'estimated'

  const t = getTheme()
  const cat = [
    `        ${t.ai}/\\_/\\${t.reset}`,
    `       ${t.ai}( o.o )${t.reset}`,
    `        ${t.ai}> ^ <${t.reset}`,
    `       ${t.accent} barecat${t.reset}`,
  ]
  for (const line of cat) {
    console.log(`      ${line}`)
  }
  console.log()

  if (counts.total > 0) {
    console.log(`  \x1b[90mResumed session: \x1b[36m${sessionName}\x1b[90m — ${counts.total} messages (${counts.user} you / ${counts.assistant} them)\x1b[0m`)
  } else {
    console.log(`  \x1b[90mNew session: \x1b[36m${sessionName}\x1b[0m`)
    saveMeta({ name: sessionName, model: currentModel, createdAt: new Date().toISOString() })
  }

  console.log(`  \x1b[90mModel: ${currentModel}\x1b[0m`)
  console.log(`  \x1b[90mContext: ${formatContextUsage(usedTokens, ctxWindow)} (${ctxSource})\x1b[0m`)
  console.log(`  \x1b[90mWorkspace: ${getWorkspaceDir()}\x1b[0m`)
  console.log(`  \x1b[90mSession: ${getEventsFilePath()}\x1b[0m`)
  console.log()

  // Show last few exchanges
  if (messages.length > 0) {
    const lastN = 6 // show last 3 pairs
    const start = Math.max(0, messages.length - lastN)
    console.log('  \x1b[90m── Recent ──\x1b[0m')
    for (let i = start; i < messages.length; i++) {
      const msg = messages[i]
      let text = ''
      if (typeof msg.content === 'string') {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        // Extract text from content blocks
        for (const block of msg.content) {
          if (typeof block === 'object' && block !== null && 'text' in block) {
            text += (block as { text: string }).text
          }
        }
      }
      if (!text) continue
      const preview = text.replace(/\n/g, ' ').slice(0, 80)
      const dots = text.length > 80 ? '...' : ''
      const label = msg.role === 'user' ? `${getTheme().user}YOU${getTheme().reset}` : `${getTheme().ai} AI${getTheme().reset}`
      console.log(`  ${label}  ${preview}${dots}`)
    }
    console.log()
  }

  console.log(`  ${getTheme().dim}Commands: /context  /model  /think  /theme  /sessions  /count  /quit${getTheme().reset}`)
  console.log(`  ${getTheme().dim}Type your message and press Enter to chat.${getTheme().reset}`)
  console.log()
}

// ── API ─────────────────────────────────────────────────
const client = new Anthropic({
  baseURL: BASE_URL,
  apiKey: API_KEY,
})

async function chat(userInput: string): Promise<string> {
  // Append user message to memory (persist only after API success)
  const userMsg: MessageParam = { role: 'user', content: userInput }
  const userTimestamp = new Date().toISOString()
  messages.push(userMsg)
  messageTimestamps.push(userTimestamp)

  // Save user event immediately
  appendEvent({
    type: 'message',
    role: 'user',
    content: userInput,
    timestamp: userTimestamp,
  })

  let activeWaitTimer: ReturnType<typeof setInterval> | null = null

  try {
    let fullResponse = ''

    // Tool use loop: keep calling until model stops requesting tools
    while (true) {
      let turnText = ''
      const md = new MarkdownRenderer()
      const contentBlocks: Array<{ type: string; [k: string]: unknown }> = []
      let currentBlockIndex = -1
      let currentToolUse: { type: 'tool_use'; id: string; name: string; input: string } | null = null

      // thinking and tools conflict via copilot-api proxy, so use them exclusively
      const useThinking = isThinkingModel(currentModel)

      // Inject time markers: date on each day's first message, full time on latest
      const meta = loadMeta()
      const startDate = meta?.startDate ?? null

      function dayLabel(dateStr: string): string {
        if (!startDate) return ''
        // Use local dates to avoid timezone offset issues
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const localToday = new Date(new Date(dateStr).toLocaleDateString('en-CA', { timeZone: tz }))
        const localStart = new Date(startDate) // YYYY-MM-DD string → local midnight
        const day = Math.floor((localToday.getTime() - localStart.getTime()) / 86400000) + 1
        return ` · Day ${day}`
      }

      // Find the last user text message index for time injection
      let lastUserTextIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
          lastUserTextIdx = i
          break
        }
      }

      const messagesWithTime = messages.map((m, i) => {
        if (m.role !== 'user' || typeof m.content !== 'string') return m

        const ts = messageTimestamps[i] || ''

        if (i === lastUserTextIdx) {
          // Latest user text message: time only, no Day
          const now = new Date()
          const timeStr = now.toLocaleString('en-US', {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dateStyle: 'full',
            timeStyle: 'short',
          })
          return { ...m, content: `[${timeStr}]\n${m.content}` }
        }

        // First user message of each day: add date marker
        if (ts) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
          const thisDay = new Date(ts).toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
          let prevDay = ''
          for (let j = i - 1; j >= 0; j--) {
            if (messages[j].role === 'user' && messageTimestamps[j]) {
              prevDay = new Date(messageTimestamps[j]).toLocaleDateString('en-CA', { timeZone: tz })
              break
            }
          }
          if (thisDay !== prevDay) {
            const date = new Date(ts).toLocaleDateString('en-US', {
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              dateStyle: 'full',
            })
            const dl = dayLabel(ts)
            return { ...m, content: `[${date}${dl}]\n${m.content}` }
          }
        }

        return m
      })

      const stream = client.messages.stream({
        model: currentModel,
        max_tokens: 16384,
        messages: messagesWithTime,
        ...(useThinking
          ? {
              thinking: { type: 'enabled' as const, budget_tokens: thinkingBudget },
            }
          : {
              thinking: { type: 'disabled' as const },
              tools: toolDefinitions as Anthropic.Messages.Tool[],
            }),
      })

      let stopReason = ''
      let firstTokenReceived = false

      // Show waiting indicator until first token arrives
      const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      let spinIdx = 0
      const waitTimer = setInterval(() => {
        process.stdout.write(`\r\x1b[90m  ${spinner[spinIdx++ % spinner.length]} thinking...\x1b[0m`)
      }, 100)
      activeWaitTimer = waitTimer

      for await (const event of stream) {
        if (!firstTokenReceived && (
          (event.type === 'content_block_delta') ||
          (event.type === 'content_block_start')
        )) {
          firstTokenReceived = true
          clearInterval(waitTimer)
          process.stdout.write('\r\x1b[2K') // clear spinner line
          process.stdout.write(getTheme().ai)
        }
        // Track content blocks as they start
        if (event.type === 'content_block_start' && 'content_block' in event) {
          currentBlockIndex++
          const block = event.content_block as { type: string; id?: string; name?: string }
          if (block.type === 'thinking') {
            process.stdout.write('\n\x1b[90m💭 ')
          } else if (block.type === 'tool_use') {
            currentToolUse = { type: 'tool_use', id: (block as { id: string }).id, name: (block as { name: string }).name, input: '' }
            const verb = (block as { name: string }).name === 'file_read' ? 'reading...' : 'writing...'
            process.stdout.write(`\n  \x1b[36m⚙ ${(block as { name: string }).name} \x1b[90m${verb}\x1b[0m`)
          } else if (block.type === 'text') {
            // text block starting
          }
        }

        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text
          process.stdout.write(md.render(text))
          turnText += text
        }
        // Stream thinking output
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'thinking_delta'
        ) {
          const text = (event.delta as { thinking: string }).thinking
          process.stdout.write(`\x1b[90m${text}\x1b[0m`)
        }
        // Collect tool_use input JSON
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'input_json_delta' &&
          currentToolUse
        ) {
          currentToolUse.input += (event.delta as { partial_json: string }).partial_json
          // Show progress dots while receiving tool input
          if (currentToolUse.input.length % 500 < 20) {
            process.stdout.write('\x1b[90m.\x1b[0m')
          }
        }

        // Content block finished
        if (event.type === 'content_block_stop') {
          if (currentToolUse) {
            try {
              const parsedInput = JSON.parse(currentToolUse.input || '{}')
              contentBlocks.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsedInput,
              })
            } catch {
              contentBlocks.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: {},
              })
            }
            currentToolUse = null
          }
        }

        if (event.type === 'message_delta' && 'delta' in event) {
          stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? ''
          // Capture real token usage — copilot-api puts all usage in message_delta
          const usage = (event as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage
          if (usage) {
            const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            if (inputTokens > 0) {
              lastApiUsage.input_tokens = inputTokens
            }
            if (usage.output_tokens) {
              lastApiUsage.output_tokens = usage.output_tokens
            }
          }
        }
      }

      clearInterval(waitTimer)
      if (!firstTokenReceived) {
        process.stdout.write('\r\x1b[2K')
      }
      process.stdout.write(md.flush())
      process.stdout.write('\x1b[0m')

      // Build final content: text + tool_use blocks
      const assistantContent: Array<{ type: string; [k: string]: unknown }> = []
      if (turnText) {
        assistantContent.push({ type: 'text', text: turnText })
      }
      for (const block of contentBlocks) {
        assistantContent.push(block)
      }

      // Append assistant message
      const assistantMsg: MessageParam = { role: 'assistant', content: assistantContent as unknown as MessageParam['content'] }
      messages.push(assistantMsg)
      messageTimestamps.push(new Date().toISOString())

      // Extract full response text
      fullResponse += turnText
      totalOutputTokens += lastApiUsage.output_tokens

      // Persist assistant message
      appendEvent({
        type: 'message',
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString(),
        model: currentModel,
      })

      // If no tool use, we're done
      if (stopReason !== 'tool_use') {
        break
      }

      // Execute tool calls
      const toolUseBlocks = assistantContent.filter(
        (b) => b.type === 'tool_use'
      ) as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>

      const toolResults: ToolResultBlockParam[] = []

      for (const toolCall of toolUseBlocks) {
        console.log(`\n  \x1b[36m⚙ ${toolCall.name}\x1b[0m \x1b[90m${formatToolInput(toolCall.input)}\x1b[0m`)

        const result = executeTool(toolCall.name, toolCall.input)

        const statusIcon = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
        const preview = result.output.length > 120
          ? result.output.slice(0, 120) + '...'
          : result.output
        console.log(`  ${statusIcon} ${preview.replace(/\n/g, ' ')}`)

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.output,
        })
      }

      // Append tool results as user message
      const toolResultMsg: MessageParam = { role: 'user', content: toolResults }
      messages.push(toolResultMsg)
      messageTimestamps.push(new Date().toISOString())
      appendEvent({
        type: 'message',
        role: 'user',
        content: toolResults,
        timestamp: new Date().toISOString(),
      })

      // Continue the loop — model will see tool results and respond
      console.log()
    }

    process.stdout.write('\n\n')

    // Persist actual usage to session.json
    if (lastApiUsage.input_tokens > 0) {
      const meta = loadMeta()
      if (meta) {
        meta.lastUsage = { ...lastApiUsage, totalOutput: totalOutputTokens }
        saveMeta(meta)
      }
    }

    return fullResponse
  } catch (err: unknown) {
    // Clear spinner if still running
    if (activeWaitTimer) {
      clearInterval(activeWaitTimer)
      process.stdout.write('\r\x1b[2K')
    }
    // Remove the user message we just pushed since the API call failed
    messages.pop()
    messageTimestamps.pop()
    removeLastEvent()
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`\n\x1b[31mAPI Error: ${errMsg}\x1b[0m\n`)
    return ''
  }
}

function formatToolInput(input: Record<string, unknown>): string {
  if ('path' in input) {
    return String(input.path)
  }
  return JSON.stringify(input).slice(0, 80)
}

// ── Commands ────────────────────────────────────────────
function handleCommand(input: string): boolean {
  const trimmed = input.trim()

  if (trimmed === '/context' || trimmed === '/ctx') {
    showContext()
    return true
  }

  if (trimmed === '/sessions') {
    const sessions = listSessions()
    console.log('\n  \x1b[36mSessions:\x1b[0m')
    for (const s of sessions) {
      const marker = s === getSessionName() ? ' \x1b[32m← current\x1b[0m' : ''
      console.log(`    ${s}${marker}`)
    }
    console.log(`\n  \x1b[90mSwitch: npm run dev -- --session=<name>\x1b[0m\n`)
    return true
  }

  if (trimmed === '/count') {
    const counts = countEvents()
    console.log(`\n  Messages: ${counts.total} (${counts.user} you / ${counts.assistant} them)\n`)
    return true
  }

  if (trimmed.startsWith('/think')) {
    const arg = trimmed.replace('/think', '').trim()
    if (arg === 'off') {
      thinkingEnabled = false
      console.log('\n  \x1b[90m💭 Thinking: OFF\x1b[0m\n')
    } else if (arg === 'on') {
      thinkingEnabled = true
      console.log(`\n  \x1b[36m💭 Thinking: ON (budget: ${thinkingBudget} tokens)\x1b[0m\n`)
    } else if (!arg) {
      const status = thinkingEnabled ? '\x1b[36mON\x1b[0m' : '\x1b[90mOFF\x1b[0m'
      console.log(`\n  💭 Thinking: ${status} (budget: ${thinkingBudget})`)
      console.log('  \x1b[90mUsage: /think on | /think off | /think <budget>\x1b[0m\n')
    } else {
      const budget = parseInt(arg)
      if (!isNaN(budget) && budget > 0) {
        thinkingBudget = budget
        thinkingEnabled = true
        console.log(`\n  \x1b[36m💭 Thinking: ON (budget: ${thinkingBudget} tokens)\x1b[0m\n`)
      } else {
        console.log('\n  Usage: /think [on|off|<budget>]\n')
      }
    }
    return true
  }

  if (trimmed.startsWith('/theme')) {
    const arg = trimmed.replace('/theme', '').trim()
    if (!arg) {
      const names = getThemeNames()
      console.log(`\n  Current: ${getTheme().ai}${getTheme().name}${getTheme().reset}`)
      console.log(`  Available: ${names.join(', ')}\n`)
    } else if (setTheme(arg)) {
      const t = getTheme()
      console.log(`\n  ${t.ai}Theme: ${t.name}${t.reset}\n`)
      // Persist theme
      const meta = loadMeta()
      if (meta) {
        meta.theme = t.name
        saveMeta(meta)
      }
    } else {
      console.log(`\n  Unknown theme. Available: ${getThemeNames().join(', ')}\n`)
    }
    return true
  }

  if (trimmed.startsWith('/model')) {
    const newModel = trimmed.replace('/model', '').trim()
    if (!newModel) {
      console.log(`\n  Current model: \x1b[33m${currentModel}\x1b[0m`)
      console.log('  Usage: /model <model-name>\n')
    } else {
      const oldModel = currentModel
      currentModel = newModel
      saveMeta({ name: getSessionName(), model: currentModel, createdAt: loadMeta()?.createdAt ?? new Date().toISOString() })
      console.log(`\n  Model: \x1b[33m${oldModel}\x1b[0m → \x1b[32m${currentModel}\x1b[0m\n`)
    }
    return true
  }

  if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
    console.log('\n  \x1b[90mSee you.\x1b[0m\n')
    process.exit(0)
  }

  if (trimmed === '/help') {
    console.log()
    console.log('  \x1b[36mCommands:\x1b[0m')
    console.log('    /context     Show context window usage with per-message breakdown')
    console.log('    /model       Show or change model')
    console.log('    /think       Toggle thinking (on/off/budget). e.g. /think 20000')
    console.log('    /theme       Switch color theme (kitten/frog/dolphin/fox/owl)')
    console.log('    /sessions    List all sessions')
    console.log('    /count       Show message counts')
    console.log('    /quit        Exit')
    console.log()
    return true
  }

  return false
}

function showContext(): void {
  const ctxWindow = getContextWindow(currentModel)
  const usedTokens = lastApiUsage.input_tokens > 0 ? lastApiUsage.input_tokens : estimateMessagesTokens(messages)
  const source = lastApiUsage.input_tokens > 0 ? 'actual' : 'estimated'

  console.log()
  console.log(`  \x1b[36mContext Window\x1b[0m`)
  console.log(`  ${formatContextUsage(usedTokens, ctxWindow)}  \x1b[90m(${source})\x1b[0m`)
  if (totalOutputTokens > 0) {
    console.log(`  \x1b[90mTotal output this session: ${totalOutputTokens.toLocaleString()} tokens\x1b[0m`)
  }
  console.log()

  // Per-message breakdown (last 20)
  const showCount = Math.min(messages.length, 20)
  const startIdx = messages.length - showCount

  if (messages.length > 20) {
    console.log(`  \x1b[90m... ${messages.length - 20} earlier messages ...\x1b[0m`)
  }

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]
    const tokens = estimateTokens(
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    )
    const label = msg.role === 'user' ? `${getTheme().user}YOU${getTheme().reset}` : `${getTheme().ai}AI ${getTheme().reset}`
    const preview =
      typeof msg.content === 'string'
        ? msg.content.slice(0, 60).replace(/\n/g, ' ')
        : '[complex]'
    console.log(
      `  #${String(i + 1).padStart(4)}  ${label}  ${String(tokens).padStart(6)} tok  ${preview}\x1b[90m${preview.length >= 60 ? '...' : ''}\x1b[0m`
    )
  }

  // Warning
  const pct = (usedTokens / ctxWindow) * 100
  if (pct > 80) {
    console.log()
    console.log(
      `  \x1b[31m⚠  Context at ${pct.toFixed(1)}%. Consider trimming events.jsonl\x1b[0m`
    )
    console.log(`  \x1b[90m  File: ${getEventsFilePath()}\x1b[0m`)
  }

  console.log()
}

// ── Main Loop ───────────────────────────────────────────
async function main(): Promise<void> {
  init()

  const { createInterface } = await import('readline')

  // terminal:true with output, suppress CJK re-rendering via _writeToOutput
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '',
  })
  ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s && !s.includes('\x1b[')) {
      process.stdout.write(s)
    }
  }

  function showPrompt(): void {
    process.stdout.write('\n')
  }

  let processing = false
  let pasteBuffer: string[] = []
  let pasteTimer: ReturnType<typeof setTimeout> | null = null

  async function send(input: string): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed) {
      return
    }
    if (processing) {
      return
    }
    processing = true

    // Show user input with prompt marker (after input, not during)
    process.stdout.write(`\x1b[90m❯ ${trimmed.replace(/\n/g, '\n  ')}\x1b[0m\n`)

    try {
      if (trimmed.startsWith('/') && !trimmed.includes('\n')) {
        if (handleCommand(trimmed)) {
          return
        }
      }
      await chat(trimmed)
    } catch (err) {
      console.error(`\n\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`)
    } finally {
      processing = false
      showPrompt()
    }
  }

  showPrompt()

  rl.on('line', (line: string) => {
    // Ignore all input while processing
    if (processing) return
    // Ignore empty lines when no paste buffer
    if (line.trim() === '' && pasteBuffer.length === 0 && !pasteTimer) return

    // If we have buffered paste and no active timer, Enter sends it
    if (pasteBuffer.length > 0 && !pasteTimer && line.trim() === '') {
      const input = pasteBuffer.join('\n')
      pasteBuffer = []
      send(input).catch(() => {
        processing = false
        showPrompt()
      })
      return
    }

    pasteBuffer.push(line)

    if (pasteTimer) clearTimeout(pasteTimer)

    pasteTimer = setTimeout(() => {
      pasteTimer = null

      if (pasteBuffer.length === 1 && pasteBuffer[0].trim() !== '') {
        const input = pasteBuffer.join('\n')
        pasteBuffer = []
        send(input).catch(() => {
          processing = false
          showPrompt()
        })
      } else if (pasteBuffer.length === 1 && pasteBuffer[0].trim() === '') {
        pasteBuffer = []
      } else {
        const nonEmpty = pasteBuffer.filter(l => l.trim() !== '').length
        process.stdout.write(`\x1b[90m  [${nonEmpty} lines pasted, press Enter to send]\x1b[0m\n`)
      }
    }, 80)
  })

  rl.on('close', () => {
    console.log('\n  \x1b[90mSee you.\x1b[0m\n')
    process.exit(0)
  })
}

main().catch(console.error)
