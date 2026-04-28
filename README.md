# 🐱 barecat

<p align="center">
  <img src="logo.png" width="180" alt="barecat logo" />
</p>

<p align="center">
  <strong>Zero-overhead LLM chat CLI. No system prompt. No memory injection. No token waste.</strong>
</p>

<p align="center">
  Every token in your context window is your actual conversation. Nothing else.
</p>

---

## Why barecat?

Most LLM tools inject system prompts, memory summaries, and framework overhead into every API call. You're paying for tokens you never asked for.

barecat sends **nothing but your conversation** to the model. Zero system prompt. Zero injected context. Pure signal.

| | Claude Code | ChatGPT | barecat |
|---|---|---|---|
| System prompt overhead | ~4,000 tokens | ~2,000 tokens | **0** |
| Memory injection | Auto | Auto | **None** |
| Context control | Automatic | Automatic | **You decide** |

## Quick Start

```bash
# Clone and install
git clone https://github.com/octo-labo/barecat && cd barecat
npm install

# Option A: Direct Anthropic API
export ANTHROPIC_BASE_URL=https://api.anthropic.com
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev

# Option B: Via GitHub Copilot proxy
npm install -g copilot-api
copilot-api start --account-type individual  # Terminal 1
npm run dev                                   # Terminal 2
```

## Features

### 📁 Persistent Named Sessions

Every conversation is saved to `events.jsonl`. Restart and pick up exactly where you left off. Run multiple sessions in parallel.

```bash
npm run dev                          # Default session
npm run dev -- --session=project-x   # Named session
```

### 📊 Context Window Monitor (Actual API Usage)

See real token usage from the API, not estimates. Per-message breakdown helps you decide what to trim.

```
/context
  Context Window
  [████████░░░░░░░░░░░░░░░░░░░░░░] 245,000 / 1,000,000 tokens (24.5%)  (actual)
  Total output this session: 12,450 tokens

  #2595  YOU   1,204 tok  Can you explain how the auth module works?
  #2596   AI   3,891 tok  The auth module uses JWT tokens with...
  #2597  YOU     156 tok  What about refresh tokens?
  #2598   AI   2,447 tok  Refresh tokens are stored in...
```

### ✂️ Manual Context Management

You own your context. Trim `events.jsonl` manually — delete what's not valuable, keep what is.

```jsonl
{"type":"message","role":"user","content":"explain X","timestamp":"2026-04-01T01:00:00Z"}
{"type":"message","role":"assistant","content":"X works by...","timestamp":"2026-04-01T01:00:05Z"}
```

Delete lines in pairs (user + assistant). No database, no index files, no hidden state.

### 📂 File Read/Write

The model can read and write files in the session's `workspace/` directory. Progress indicator shows real-time status for large files.

### 🧠 Extended Thinking

Toggle chain-of-thought reasoning. Thinking and tools are mutually exclusive (Anthropic API constraint via proxy).

```
/think on      # Enable thinking (disables file tools)
/think off     # Disable thinking (enables file tools)
/think 20000   # Set thinking token budget
/think         # Show current status
```

### 🔄 Model Switching

Switch models mid-conversation without losing context.

```
/model claude-sonnet-4.5
  Model: claude-opus-4.6 → claude-sonnet-4.5
```

### 🎨 Color Themes

Five built-in themes, persisted per session.

```
/theme kitten    # 🐱 Purple/pink (default)
/theme frog      # 🐸 Green
/theme dolphin   # 🐬 Ocean blue
/theme fox       # 🦊 Warm orange
/theme owl       # 🦉 Monochrome
```

### ⏰ Time Awareness

The model sees the current date/time on your latest message and date markers on each day's first message. No wasted tokens on older messages.

### 📋 Multiline Paste

Paste multiline text — barecat auto-detects and waits for Enter to send. Single-line input sends immediately.

### 🔁 Session Resume

On startup, barecat shows the last few exchanges so you can orient yourself:

```
       /\_/\
      ( o.o )
       > ^ <
       barecat

  Resumed session: default — 2604 messages (1293 you / 1311 them)
  Model: claude-opus-4.6
  Context: [████████░░░░░░░░░░░░░░] 402,897 / 1,000,000 tokens (40.3%)  (actual)

  ── Recent ──
  YOU  Can you explain how the auth module works?
   AI  The auth module uses JWT tokens with refresh rotation...
  YOU  What about edge cases?
   AI  Good question. There are three main edge cases...
```

## Commands

| Command | Description |
|---------|-------------|
| `/context` | Context window usage with per-message breakdown |
| `/model [name]` | Show or switch model |
| `/think [on\|off\|budget]` | Toggle extended thinking |
| `/theme [name]` | Switch color theme |
| `/sessions` | List all sessions |
| `/count` | Message statistics |
| `/help` | Show commands |
| `/quit` | Exit |

## Data Storage

```
~/.barecat/sessions/
├── default/
│   ├── events.jsonl    ← Your conversation (edit to manage context)
│   ├── session.json    ← Model, theme, token usage
│   └── workspace/      ← File read/write directory
├── project-x/
│   └── ...
```

No databases. No cloud sync. No hidden state. Two folders, copy and done.

## Migrate from Copilot CLI

```bash
python migrate.py path/to/old/events.jsonl ~/.barecat/sessions/my-session/events.jsonl
```

Strips all framework overhead (turn metadata, hooks, tool execution logs). Typical reduction: **60-70%**.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | `http://localhost:4141` | API endpoint |
| `ANTHROPIC_API_KEY` | `sk-dummy` | API key (dummy for proxy mode) |
| `ANTHROPIC_AUTH_TOKEN` | — | Alternative API key variable |
| `BARECAT_MODEL` | `claude-opus-4.6` | Default model |
| `BARECAT_SESSION` | `default` | Default session name |

## Architecture

```
Your input
  ↓
barecat (Node.js, 6 files, ~1,300 lines)
  ↓ Anthropic SDK (streaming)
API endpoint (direct or proxy)
  ↓
Streamed response + markdown rendering
  ↓
Display + append to events.jsonl
```

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | ~750 | Main loop, streaming, tool execution, commands |
| `session.ts` | ~165 | Session persistence and events.jsonl read/write |
| `tools.ts` | ~117 | File read/write tool definitions |
| `markdown.ts` | ~95 | Streaming markdown → terminal ANSI rendering |
| `tokens.ts` | ~78 | Token estimation and context usage bar |
| `themes.ts` | ~77 | Color theme definitions |

## Design Philosophy

1. **Zero injection** — The model sees only your messages. No system prompt, no hidden instructions, no framework overhead.
2. **You own the context** — Manual trimming beats algorithmic compression. You know what matters; the algorithm doesn't.
3. **Files, not databases** — Everything is human-readable, `grep`-able, and portable. `cp -r ~/.barecat/ /new-machine/` and you're done.
4. **Minimal surface area** — ~1,300 lines of TypeScript. Read the entire codebase in 15 minutes.

## Tips

- Use `Ctrl+C` to cancel current input or abort a response
- Tool calls (file read/write) are stored in `events.jsonl` — trim them after the files are saved to free context
- Extended thinking and tools can't be used simultaneously; toggle with `/think`
- On Windows, barecat auto-sets UTF-8 encoding (`chcp 65001`) for proper CJK support

## License

MIT
