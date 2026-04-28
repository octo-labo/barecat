// Streaming markdown → ANSI terminal renderer
// Converts markdown formatting to terminal escape codes on the fly

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALIC = '\x1b[3m'
const RESET_BOLD = '\x1b[22m'
const RESET_DIM = '\x1b[22m'
const RESET_ITALIC = '\x1b[23m'
const CYAN = '\x1b[36m'
const RESET_COLOR = '\x1b[39m'

export class MarkdownRenderer {
  private buffer = ''

  // Process a streaming text chunk → return ANSI-formatted output
  render(chunk: string): string {
    this.buffer += chunk

    // Try to process complete markdown tokens
    let output = ''
    let i = 0

    while (i < this.buffer.length) {
      // **bold**
      if (this.buffer[i] === '*' && this.buffer[i + 1] === '*') {
        const end = this.buffer.indexOf('**', i + 2)
        if (end !== -1) {
          output += BOLD + this.buffer.slice(i + 2, end) + RESET_BOLD
          i = end + 2
          continue
        } else {
          // Incomplete — wait for more data
          break
        }
      }

      // *italic* (single star, not double)
      if (this.buffer[i] === '*' && this.buffer[i + 1] !== '*') {
        const end = this.buffer.indexOf('*', i + 1)
        if (end !== -1 && this.buffer[end + 1] !== '*') {
          output += ITALIC + this.buffer.slice(i + 1, end) + RESET_ITALIC
          i = end + 1
          continue
        } else if (end === -1) {
          break
        }
      }

      // `code`
      if (this.buffer[i] === '`' && this.buffer[i + 1] !== '`') {
        const end = this.buffer.indexOf('`', i + 1)
        if (end !== -1) {
          output += CYAN + this.buffer.slice(i + 1, end) + RESET_COLOR
          i = end + 1
          continue
        } else {
          break
        }
      }

      // ```code block``` — just strip the markers
      if (this.buffer[i] === '`' && this.buffer[i + 1] === '`' && this.buffer[i + 2] === '`') {
        const end = this.buffer.indexOf('```', i + 3)
        if (end !== -1) {
          // Skip language hint on first line
          let blockStart = i + 3
          const newline = this.buffer.indexOf('\n', blockStart)
          if (newline !== -1 && newline < end) {
            blockStart = newline + 1
          }
          output += DIM + this.buffer.slice(blockStart, end) + RESET_DIM
          i = end + 3
          continue
        } else {
          break
        }
      }

      output += this.buffer[i]
      i++
    }

    // Keep unprocessed remainder in buffer
    this.buffer = this.buffer.slice(i)
    return output
  }

  // Flush any remaining buffer (end of stream)
  flush(): string {
    const remaining = this.buffer
    this.buffer = ''
    return remaining
  }
}
