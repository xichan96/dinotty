export interface SoundConfig {
  source: 'builtin' | 'custom'
  value: string
  volume: number
}

interface BuiltinDef {
  type: OscillatorType
  freqs: number[]
  duration: number
  gap: number
}

const BUILTIN_SOUNDS: Record<string, BuiltinDef> = {
  ding: { type: 'sine', freqs: [880], duration: 150, gap: 0 },
  'chime-up': { type: 'sine', freqs: [523, 659, 784], duration: 100, gap: 80 },
  'chime-down': { type: 'sine', freqs: [784, 659, 523], duration: 100, gap: 80 },
  'double-beep': { type: 'square', freqs: [660, 660], duration: 80, gap: 100 },
  alarm: { type: 'sawtooth', freqs: [440, 440, 440], duration: 200, gap: 150 },
  'soft-ping': { type: 'triangle', freqs: [1200], duration: 100, gap: 0 },
  'task-done': { type: 'sine', freqs: [523, 659, 784, 1047], duration: 80, gap: 60 },
  'error-buzz': { type: 'sawtooth', freqs: [220], duration: 300, gap: 0 },
}

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

function playBuiltin(name: string, volume: number) {
  const def = BUILTIN_SOUNDS[name]
  if (!def) return
  const ctx = getAudioContext()
  const gainNode = ctx.createGain()
  gainNode.gain.value = Math.max(0, Math.min(1, volume))
  gainNode.connect(ctx.destination)

  let offset = ctx.currentTime
  for (const freq of def.freqs) {
    const osc = ctx.createOscillator()
    osc.type = def.type
    osc.frequency.value = freq
    osc.connect(gainNode)
    osc.start(offset)
    osc.stop(offset + def.duration / 1000)
    offset += (def.duration + def.gap) / 1000
  }
}

export function playSound(config: SoundConfig) {
  if (config.source === 'builtin') {
    playBuiltin(config.value, config.volume)
  } else {
    const audio = new Audio(config.value)
    audio.volume = Math.max(0, Math.min(1, config.volume))
    audio.play().catch(() => {})
  }
}

const productionNotificationPresentationEffects = { playSound }
const notificationPresentationEffects = { ...productionNotificationPresentationEffects }

export function __setPresentationEffectsForTest(
  overrides: Partial<typeof notificationPresentationEffects>
) {
  Object.assign(notificationPresentationEffects, overrides)
}

export function resetPresentationEffects() {
  Object.assign(notificationPresentationEffects, productionNotificationPresentationEffects)
}

export function getBuiltinSoundNames(): string[] {
  return Object.keys(BUILTIN_SOUNDS)
}

export { notificationPresentationEffects }
