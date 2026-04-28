// Terminal color themes

export interface Theme {
  name: string
  ai: string       // AI response text
  user: string     // User prompt symbol
  info: string     // Info/status text
  accent: string   // Highlights, titles
  dim: string      // Secondary text
  reset: string
}

const themes: Record<string, Theme> = {
  kitten: {
    name: 'kitten',
    ai: '\x1b[35m',      // magenta
    user: '\x1b[34m',    // blue
    info: '\x1b[36m',    // cyan
    accent: '\x1b[36m',  // cyan
    dim: '\x1b[90m',     // gray
    reset: '\x1b[0m',
  },
  frog: {
    name: 'frog',
    ai: '\x1b[32m',      // green
    user: '\x1b[36m',    // cyan
    info: '\x1b[33m',    // yellow
    accent: '\x1b[32m',  // green
    dim: '\x1b[90m',     // gray
    reset: '\x1b[0m',
  },
  dolphin: {
    name: 'dolphin',
    ai: '\x1b[36m',      // cyan
    user: '\x1b[34m',    // blue
    info: '\x1b[34m',    // blue
    accent: '\x1b[96m',  // bright cyan
    dim: '\x1b[90m',     // gray
    reset: '\x1b[0m',
  },
  fox: {
    name: 'fox',
    ai: '\x1b[33m',      // yellow
    user: '\x1b[31m',    // red
    info: '\x1b[33m',    // yellow
    accent: '\x1b[91m',  // bright red
    dim: '\x1b[90m',     // gray
    reset: '\x1b[0m',
  },
  owl: {
    name: 'owl',
    ai: '\x1b[37m',      // white
    user: '\x1b[37m',    // white
    info: '\x1b[90m',    // gray
    accent: '\x1b[1m',   // bold
    dim: '\x1b[90m',     // gray
    reset: '\x1b[0m',
  },
}

let current: Theme = themes.kitten

export function getTheme(): Theme {
  return current
}

export function setTheme(name: string): boolean {
  if (name in themes) {
    current = themes[name]
    return true
  }
  return false
}

export function getThemeNames(): string[] {
  return Object.keys(themes)
}
