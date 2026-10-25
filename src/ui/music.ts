/** Small, default-off procedural music cues. Only presentation time enters Web Audio. */
export function cue(context: BaseAudioContext, tense: boolean, when = context.currentTime) {
  for (const frequency of tense ? [146.83, 155.56] : [196, 293.66]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.025, when + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(when);
    oscillator.stop(when + 2.1);
  }
}
let context: AudioContext | undefined;
let enabled = false;
let lastCue = -Infinity;
export async function toggleMusic(): Promise<boolean> {
  if (enabled) {
    enabled = false;
    await context?.suspend();
    return false;
  }
  if (typeof AudioContext === 'undefined') return false;
  context ??= new AudioContext();
  await context.resume();
  enabled = true;
  cue(context, false);
  lastCue = performance.now();
  return true;
}
export function musicEvent(tense: boolean) {
  if (!enabled || !context || document.hidden || performance.now() - lastCue < 8000) return;
  cue(context, tense);
  lastCue = performance.now();
}
