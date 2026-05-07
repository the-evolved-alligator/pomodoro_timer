import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  dailyKeyFromDate,
  initialState,
  reduce,
  type Phase,
  type PomodoroState,
  type Settings
} from './lib/pomodoroMachine'
import { loadSettings, loadState, saveSettings, saveState } from './lib/storage'

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'focus':
      return 'Focus'
    case 'shortBreak':
      return 'Short break'
    case 'longBreak':
      return 'Long break'
    case 'idle':
      return 'Ready'
    case 'completed':
      return 'Done'
  }
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function secondsFromMinutesInput(value: string, minMinutes: number, maxMinutes: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return minMinutes * 60
  const minutes = clamp(Math.round(parsed), minMinutes, maxMinutes)
  return minutes * 60
}

type Action =
  | { type: 'MACHINE'; next: PomodoroState }
  | { type: 'SET_SETTINGS'; next: Settings }

type Model = {
  state: PomodoroState
  settings: Settings
}

function modelReducer(model: Model, action: Action): Model {
  switch (action.type) {
    case 'MACHINE':
      return { ...model, state: action.next }
    case 'SET_SETTINGS':
      return { ...model, settings: action.next }
  }
}

function useRepeatingBeep(isRinging: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isRinging) {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const ensureCtx = () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext()
      return ctxRef.current
    }

    const play = () => {
      const ctx = ensureCtx()
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.04
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.18)
    }

    // play immediately, then repeat until acknowledged
    play()
    timerRef.current = window.setInterval(play, 1200)

    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [isRinging])
}

export default function App() {
  const [hydrated, setHydrated] = useState(false)

  const initialModel: Model = useMemo(() => {
    const now = Date.now()
    const key = dailyKeyFromDate(new Date(now))
    const settings = loadSettings()
    const persisted = loadState()
    const base = initialState(now, key)
    if (!persisted) return { state: base, settings }
    return { state: { ...base, ...persisted }, settings }
  }, [])

  const [model, dispatch] = useReducer(modelReducer, initialModel)

  useEffect(() => {
    if (!hydrated) {
      setHydrated(true)
      return
    }
    saveSettings(model.settings)
  }, [hydrated, model.settings])

  useEffect(() => {
    if (!hydrated) return
    saveState(model.state)
  }, [hydrated, model.state])

  useEffect(() => {
    const id = window.setInterval(() => {
      const nowMs = Date.now()
      const key = dailyKeyFromDate(new Date(nowMs))
      if (key !== model.state.dailyKey) {
        dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'RESET_DAY', dailyKey: key }) })
      }
      dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'TICK', nowMs }) })
    }, 250)
    return () => window.clearInterval(id)
  }, [model.state])

  const phaseForUi: Phase = model.state.phase

  useRepeatingBeep(model.state.soundIsRinging)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      const nowMs = Date.now()
      if (model.state.soundIsRinging) {
        dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'ACKNOWLEDGE', nowMs, settings: model.settings }) })
        return
      }
      if (model.state.isRunning) {
        dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'PAUSE', nowMs }) })
        return
      }
      // if timer hit 0 and is waiting for user, acknowledge; else start/resume
      if (!model.state.isRunning && model.state.remainingSeconds === 0 && model.state.phase !== 'idle') {
        dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'ACKNOWLEDGE', nowMs, settings: model.settings }) })
        return
      }
      dispatch({
        type: 'MACHINE',
        next: reduce(model.state, { type: 'START_OR_RESUME', nowMs, settings: model.settings })
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [model.settings, model.state])

  const nowMs = Date.now()
  const primaryLabel = model.state.soundIsRinging
    ? 'Acknowledge (Space)'
    : model.state.isRunning
      ? 'Pause (Space)'
      : model.state.phase === 'idle'
        ? 'Start Focus (Space)'
        : model.state.remainingSeconds === 0
          ? 'Acknowledge (Space)'
          : 'Resume (Space)'

  const onPrimary = () => {
    const nowMs = Date.now()
    if (model.state.soundIsRinging || (!model.state.isRunning && model.state.remainingSeconds === 0 && model.state.phase !== 'idle')) {
      dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'ACKNOWLEDGE', nowMs, settings: model.settings }) })
      return
    }
    if (model.state.isRunning) {
      dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'PAUSE', nowMs }) })
      return
    }
    dispatch({ type: 'MACHINE', next: reduce(model.state, { type: 'START_OR_RESUME', nowMs, settings: model.settings }) })
  }

  const canAcknowledge = model.state.soundIsRinging || (!model.state.isRunning && model.state.remainingSeconds === 0 && model.state.phase !== 'idle')
  const canStop = model.state.phase !== 'idle' || model.state.isRunning || model.state.remainingSeconds > 0 || model.state.soundIsRinging
  const modeForUi = model.state.soundIsRinging
    ? 'ringing'
    : model.state.phase === 'idle'
      ? 'ready'
      : model.state.isRunning
        ? 'running'
        : 'paused'

  return (
    <div className="app" data-phase={phaseForUi} data-mode={modeForUi} aria-label="Pomodoro Timer">
      <div className="shell">
        <div className="topbar">
          <div className="title">Pomodoro</div>
          <div className="phasePill">
            {phaseLabel(model.state.phase)}
            {model.state.soundIsRinging ? ' • ringing' : ''}
          </div>
        </div>

        <div className="content">
          <div className="timer" aria-live="polite">
            {model.state.isRunning
              ? formatMmSs(Math.max(0, Math.round((model.state.endsAtMs! - nowMs) / 1000)))
              : formatMmSs(model.state.remainingSeconds)}
          </div>

          <div className="subline">
            <div>Cycle: {model.state.cycleIndex + 1}</div>
            <div>Today: {model.state.completedFocusCountToday}</div>
          </div>

          <div className="actions">
            <button className="primary" onClick={onPrimary}>
              {primaryLabel}
            </button>
            <button
              className={canAcknowledge ? 'danger' : ''}
              disabled={!canAcknowledge}
              onClick={() =>
                dispatch({
                  type: 'MACHINE',
                  next: reduce(model.state, { type: 'ACKNOWLEDGE', nowMs: Date.now(), settings: model.settings })
                })
              }
            >
              Acknowledge
            </button>
            <button
              disabled={!canStop}
              onClick={() =>
                dispatch({
                  type: 'MACHINE',
                  next: reduce(model.state, { type: 'STOP' })
                })
              }
            >
              Stop
            </button>
          </div>

          <div className="hint">Space: start/pause/acknowledge/stop sound (when not typing).</div>

          <div className="grid2">
            <div className="card">
              <label>
                Task label (optional)
                <input
                  value={model.state.taskLabel}
                  placeholder="What are you working on?"
                  onChange={(e) =>
                    dispatch({
                      type: 'MACHINE',
                      next: reduce(model.state, { type: 'SET_TASK_LABEL', label: e.target.value })
                    })
                  }
                />
              </label>
            </div>

            <div className="card">
              <div className="grid2">
                <label>
                  Focus (min)
                  <input
                    inputMode="numeric"
                    value={Math.round(model.settings.focusSeconds / 60)}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_SETTINGS',
                        next: {
                          ...model.settings,
                          focusSeconds: secondsFromMinutesInput(e.target.value, 10, 90)
                        }
                      })
                    }
                  />
                </label>
                <label>
                  Short break (min)
                  <input
                    inputMode="numeric"
                    value={Math.round(model.settings.shortBreakSeconds / 60)}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_SETTINGS',
                        next: {
                          ...model.settings,
                          shortBreakSeconds: secondsFromMinutesInput(e.target.value, 5, 30)
                        }
                      })
                    }
                  />
                </label>
                <label>
                  Long break (min)
                  <input
                    inputMode="numeric"
                    value={Math.round(model.settings.longBreakSeconds / 60)}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_SETTINGS',
                        next: {
                          ...model.settings,
                          longBreakSeconds: secondsFromMinutesInput(e.target.value, 5, 45)
                        }
                      })
                    }
                  />
                </label>
                <label>
                  Long break every
                  <input
                    inputMode="numeric"
                    value={model.settings.longBreakEvery}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_SETTINGS',
                        next: {
                          ...model.settings,
                          longBreakEvery: clamp(Math.round(Number(e.target.value) || DEFAULT_SETTINGS.longBreakEvery), 2, 8)
                        }
                      })
                    }
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

