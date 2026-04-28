// Tool system — minimal tool definitions for file read/write
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve, isAbsolute } from 'path'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export interface ToolResult {
  success: boolean
  output: string
}

// Working directory for relative paths
let workingDir = process.cwd()

export function setWorkingDir(dir: string): void {
  workingDir = dir
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(workingDir, filePath)
}

// ── Tool Definitions (sent to model) ────────────────────

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'file_read',
    description:
      'Read the contents of a file. Returns the full text content. Use this to read letters, documents, code, or any text file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (absolute or relative to working directory)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories are created automatically. Use this to write letters, essays, teaching materials, notes, or any text content.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (absolute or relative to working directory)',
        },
        content: {
          type: 'string',
          description: 'The full content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
]

// ── Tool Execution ──────────────────────────────────────

export function executeTool(
  name: string,
  input: Record<string, unknown>
): ToolResult {
  switch (name) {
    case 'file_read':
      return fileRead(String(input.path))
    case 'file_write':
      return fileWrite(String(input.path), String(input.content))
    default:
      return { success: false, output: `Unknown tool: ${name}` }
  }
}

function fileRead(path: string): ToolResult {
  const resolved = resolvePath(path)
  try {
    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${resolved}` }
    }
    const content = readFileSync(resolved, 'utf-8')
    return { success: true, output: content }
  } catch (err) {
    return {
      success: false,
      output: `Error reading ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function fileWrite(path: string, content: string): ToolResult {
  const resolved = resolvePath(path)
  try {
    const dir = dirname(resolved)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(resolved, content, 'utf-8')
    return { success: true, output: `Written to ${resolved} (${content.length} chars)` }
  } catch (err) {
    return {
      success: false,
      output: `Error writing ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
