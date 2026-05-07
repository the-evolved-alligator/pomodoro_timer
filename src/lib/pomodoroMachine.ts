export type Phase = 'idle' | 'focus' | 'shortBreak' | 'longBreak' | 'completed'

export type Settings = {
  focusSeconds: number
  shortBreakSeconds: number
  longBreakSeconds: number
  longBreakEvery: number
}

export const DEFAULT_SETTINGS: Settings = {
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  longBreakEvery: 4
}

export type PomodoroState = {
  phase: Phase
  isRunning: boolean
  endsAtMs: number | null
  remainingSeconds: number
  cycleIndex: number
  completedFocusCountToday: number
  dailyKey: string
  taskLabel: string
  soundIsRinging: boolean
}

export type PomodoroEvent =
  | { type: 'START_OR_RESUME'; nowMs: number; settings: Settings }
  | { type: 'PAUSE'; nowMs: number }
  | { type: 'STOP' }
  | { type: 'TICK'; nowMs: number }
  | { type: 'ACKNOWLEDGE'; nowMs: number; settings: Settings }
  | { type: 'SET_TASK_LABEL'; label: string }
  | { type: 'HYDRATE'; state: PomodoroState }
  | { type: 'RESET_DAY'; dailyKey: string }

export function dailyKeyFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function initialState(nowMs: number, dailyKey: string): PomodoroState {
  return {
    phase: 'idle',
    isRunning: false,
    endsAtMs: null,
    remainingSeconds: 0,
    cycleIndex: 0,
    completedFocusCountToday: 0,
    dailyKey,
    taskLabel: '',
    soundIsRinging: false
  }
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function phaseDurationSeconds(phase: Phase, settings: Settings): number {
  switch (phase) {
    case 'focus':
      return settings.focusSeconds
    case 'shortBreak':
      return settings.shortBreakSeconds
    case 'longBreak':
      return settings.longBreakSeconds
    default:
      return 0
  }
}

function nextBreakPhaseAfterFocus(cycleIndex: number, settings: Settings): Phase {
  const nextCycle = cycleIndex + 1
  return nextCycle % settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak'
}

function computeRemainingSeconds(nowMs: number, endsAtMs: number | null): number {
  if (endsAtMs == null) return 0
  return clampNonNegativeInt(Math.ceil((endsAtMs - nowMs) / 1000))
}

function startPhase(state: PomodoroState, phase: Phase, nowMs: number, settings: Settings): PomodoroState {
  const durationSeconds = phaseDurationSeconds(phase, settings)
  const endsAtMs = nowMs + durationSeconds * 1000
  return {
    ...state,
    phase,
    isRunning: true,
    endsAtMs,
    remainingSeconds: durationSeconds,
    soundIsRinging: false
  }
}

function pause(state: PomodoroState, nowMs: number): PomodoroState {
  if (!state.isRunning || state.endsAtMs == null) return state
  const remainingSeconds = computeRemainingSeconds(nowMs, state.endsAtMs)
  return {
    ...state,
    isRunning: false,
    endsAtMs: null,
    remainingSeconds
  }
}

function resume(state: PomodoroState, nowMs: number): PomodoroState {
  if (state.isRunning) return state
  if (state.phase === 'idle' || state.phase === 'completed') return state
  const endsAtMs = nowMs + state.remainingSeconds * 1000
  return { ...state, isRunning: true, endsAtMs }
}

function ringCompletion(state: PomodoroState): PomodoroState {
  return {
    ...state,
    isRunning: false,
    endsAtMs: null,
    remainingSeconds: 0,
    soundIsRinging: true
  }
}

export function reduce(state: PomodoroState, event: PomodoroEvent): PomodoroState {
  switch (event.type) {
    case 'HYDRATE':
      return event.state
    case 'SET_TASK_LABEL':
      return { ...state, taskLabel: event.label }
    case 'STOP': {
      return {
        ...state,
        phase: 'idle',
        isRunning: false,
        endsAtMs: null,
        remainingSeconds: 0,
        cycleIndex: 0,
        taskLabel: '',
        soundIsRinging: false
      }
    }
    case 'RESET_DAY': {
      if (state.dailyKey === event.dailyKey) return state
      return {
        ...state,
        dailyKey: event.dailyKey,
        completedFocusCountToday: 0
      }
    }
    case 'START_OR_RESUME': {
      if (state.soundIsRinging) {
        return { ...state, soundIsRinging: false }
      }
      if (state.phase === 'idle' || state.phase === 'completed') {
        return startPhase(state, 'focus', event.nowMs, event.settings)
      }
      if (state.isRunning) return state
      return resume(state, event.nowMs)
    }
    case 'PAUSE': {
      if (state.soundIsRinging) {
        return { ...state, soundIsRinging: false }
      }
      return pause(state, event.nowMs)
    }
    case 'TICK': {
      if (!state.isRunning) return state
      if (state.endsAtMs == null) return { ...state, isRunning: false }
      const remainingSeconds = computeRemainingSeconds(event.nowMs, state.endsAtMs)
      if (remainingSeconds > 0) return { ...state, remainingSeconds }
      return ringCompletion(state)
    }
    case 'ACKNOWLEDGE': {
      if (state.soundIsRinging) {
        const afterSilence = { ...state, soundIsRinging: false }
        if (state.phase === 'focus') {
          return {
            ...startPhase(afterSilence, nextBreakPhaseAfterFocus(state.cycleIndex, event.settings), event.nowMs, event.settings),
            cycleIndex: state.cycleIndex + 1,
            completedFocusCountToday: state.completedFocusCountToday + 1
          }
        }
        if (state.phase === 'shortBreak' || state.phase === 'longBreak') {
          return startPhase(afterSilence, 'focus', event.nowMs, event.settings)
        }
        if (state.phase === 'idle') {
          return startPhase(afterSilence, 'focus', event.nowMs, event.settings)
        }
        return afterSilence
      }

      if (state.phase === 'idle' || state.phase === 'completed') {
        return startPhase(state, 'focus', event.nowMs, event.settings)
      }
      if (state.isRunning) return state
      // If completed but not ringing (e.g. hydrated), treat acknowledge as move forward.
      if (state.phase === 'focus') {
        return {
          ...startPhase(state, nextBreakPhaseAfterFocus(state.cycleIndex, event.settings), event.nowMs, event.settings),
          cycleIndex: state.cycleIndex + 1,
          completedFocusCountToday: state.completedFocusCountToday + 1
        }
      }
      if (state.phase === 'shortBreak' || state.phase === 'longBreak') {
        return startPhase(state, 'focus', event.nowMs, event.settings)
      }
      return state
    }
  }
}

