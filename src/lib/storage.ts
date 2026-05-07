import type { PomodoroState, Settings } from './pomodoroMachine'
import { DEFAULT_SETTINGS } from './pomodoroMachine'

const SETTINGS_KEY = 'pomodoro:settings:v1'
const STATE_KEY = 'pomodoro:state:v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      focusSeconds: typeof parsed.focusSeconds === 'number' ? parsed.focusSeconds : DEFAULT_SETTINGS.focusSeconds,
      shortBreakSeconds: typeof parsed.shortBreakSeconds === 'number' ? parsed.shortBreakSeconds : DEFAULT_SETTINGS.shortBreakSeconds,
      longBreakSeconds: typeof parsed.longBreakSeconds === 'number' ? parsed.longBreakSeconds : DEFAULT_SETTINGS.longBreakSeconds,
      longBreakEvery: typeof parsed.longBreakEvery === 'number' ? parsed.longBreakEvery : DEFAULT_SETTINGS.longBreakEvery
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function loadState(): PomodoroState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PomodoroState
  } catch {
    return null
  }
}

export function saveState(s: PomodoroState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(s))
}

