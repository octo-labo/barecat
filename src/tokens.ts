// Token estimation utilities
// Uses cl100k_base approximation: ~4 chars per token for English, ~2 for CJK

export function estimateTokens(text: string): number {
  let count = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // CJK characters: roughly 1 token per char
    if (code >= 0x4e00 && code <= 0x9fff) {
      count += 1
    } else if (code >= 0x3000 && code <= 0x303f) {
      count += 1
    } else if (code >= 0xff00 && code <= 0xffef) {
      count += 1
    } else {
      count += 0.25 // ~4 chars per token for latin
    }
  }
  return Math.ceil(count)
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: unknown }>
): number {
  let total = 0
  for (const msg of messages) {
    total += 4 // message overhead
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null && 'text' in block) {
          total += estimateTokens(String((block as { text: string }).text))
        } else if (typeof block === 'object' && block !== null && 'content' in block) {
          total += estimateTokens(String((block as { content: string }).content))
        }
      }
    }
  }
  return total
}

// Context window sizes by model
const MODEL_CONTEXT: Record<string, number> = {
  // Anthropic
  'claude-opus-4.6-1m': 1000000,
  'claude-opus-4.7': 200000,
  'claude-opus-4.6': 200000,
  'claude-opus-4.5': 200000,
  'claude-sonnet-4.6': 200000,
  'claude-sonnet-4.5': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-4.5': 200000,
  // OpenAI
  'gpt-5.5': 400000,
  'gpt-5.4': 400000,
  'gpt-5.4-mini': 400000,
  'gpt-5.2': 200000,
  'gpt-5.2-codex': 200000,
  'gpt-5.3-codex': 200000,
  'gpt-5-mini': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'gpt-4': 8192,
  // Google
  'gemini-2.5-pro': 1000000,
  'gemini-3.1-pro-preview': 1000000,
  'gemini-3-flash-preview': 1000000,
}

export function getContextWindow(model: string): number {
  if (model in MODEL_CONTEXT) return MODEL_CONTEXT[model]
  // fuzzy match: if model name contains '1m', assume 1M context
  if (model.includes('1m')) return 1000000
  return 200000
}

export function formatContextUsage(
  usedTokens: number,
  maxTokens: number
): string {
  const pct = (usedTokens / maxTokens) * 100
  const bar = buildBar(pct)
  return `${bar} ${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${pct.toFixed(1)}%)`
}

function buildBar(pct: number): string {
  const width = 30
  const filled = Math.min(width, Math.round((Math.min(pct, 100) / 100) * width))
  const empty = width - filled
  const color = pct > 90 ? '\x1b[31m' : pct > 70 ? '\x1b[33m' : '\x1b[32m'
  const reset = '\x1b[0m'
  return `${color}[${'█'.repeat(filled)}${'░'.repeat(empty)}]${reset}`
}
