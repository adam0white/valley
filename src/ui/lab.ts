import { createLab } from '@adam0white/lab-client';
import { feedbackPersonaControl } from '@adam0white/lab-kit';
import { compactRun, type SavedGame } from '../sim/game.ts';

export const lab = createLab({ game: 'valley' });
lab.setPersonaRecording(`valley-startup-${crypto.randomUUID()}`);
export type GameSpeed = 'automatic' | 'slow' | 'steady' | 'fast';
type RunControls = {
  getRun: () => SavedGame | undefined;
  hasRun: () => boolean;
  download: () => void;
  bindVolume: () => Promise<void>;
  notebook: () => void;
  toTitle: () => void;
  getSpeed: () => GameSpeed;
  setSpeed: (speed: GameSpeed) => void;
  date: () => string;
};
let syncRunControls: (() => void) | undefined;
let showMenu: (() => void) | undefined;
let showFeedback: (() => void) | undefined;
let currentScreen: 'title' | 'play' | 'ending' = 'title';
const NAME_KEY = 'hf-lab-feedback-name';
function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function recordingOff(): boolean {
  return readLocal('hf-lab-recording-off') === '1' || readLocal('hf-lab-recording-off:valley') === '1';
}
export function openMenu(): void {
  showMenu?.();
}
export function openFeedback(): void {
  showFeedback?.();
}

/** The top bar owns the menu trigger; these dialogs keep their DOM through screen changes. */
export function mountLab(options: RunControls): void {
  if (document.getElementById('lab-controls')) return;
  const controls = document.createElement('div');
  controls.id = 'lab-controls';
  controls.innerHTML = `<dialog class="game-menu-panel" aria-labelledby="valley-menu-title">
    <header class="menu-head"><h2 id="valley-menu-title">Game menu <small data-menu-date></small></h2><button type="button" data-close-menu aria-label="Close menu">×</button></header>
    <div class="menu-body"><p>The valley waits while this is open. Your place is kept as you play.</p>
    <button type="button" data-notebook>The notebook <span aria-hidden="true">▸</span></button>
    <fieldset class="menu-speed"><legend>Time</legend><div role="group" aria-label="Time control">${(['automatic', 'slow', 'steady', 'fast'] as const).map((speed) => `<button type="button" data-speed="${speed}" aria-pressed="false">${speed.charAt(0).toUpperCase() + speed.slice(1)}</button>`).join('')}</div></fieldset>
    <button type="button" data-feedback>Send word <span aria-hidden="true">▸</span></button>
    <button type="button" data-fullscreen class="phone-only">Full screen</button>
    <button type="button" data-title>To the title page</button>
    <a href="https://human.adamwhite.work/">All games</a></div>
    <footer class="menu-footer"><label><input type="checkbox" data-events> Record play for the lab</label><a href="https://human.adamwhite.work/lab/privacy/" target="_blank" rel="noopener">Lab privacy</a><button type="button" class="primary" data-resume>Back to the valley</button></footer>
  </dialog>
  <dialog class="feedback-panel" aria-labelledby="valley-feedback-title">
    <header class="feedback-head"><button type="button" data-feedback-back aria-label="Back to menu">←</button><h2 id="valley-feedback-title">Send word</h2><button type="button" data-close-feedback aria-label="Close Send word">×</button></header>
    <form class="feedback-form"><div class="feedback-body"><p data-feedback-lead>Send a note about this game. Recording and continuing-person choices are optional.</p>
    <div class="feedback-verdicts" role="group" aria-label="Would you keep playing?"><button type="button" data-verdict="keep" aria-pressed="false">I'd keep playing</button><button type="button" data-verdict="mixed" aria-pressed="false">Not sure</button><button type="button" data-verdict="quit" aria-pressed="false">I'd stop here</button></div>
    <label for="valley-feedback-note">What happened in the valley, what you wanted, what got in the way.</label><textarea id="valley-feedback-note" rows="4" maxlength="12000"></textarea>
    <label for="valley-feedback-name">Your name or tester id <small>(optional)</small></label><input id="valley-feedback-name" type="text" maxlength="60" autocomplete="nickname"><p class="soft">A name labels your player id and its past and future linked history on this device. Leave it empty to stay pseudonymous.</p>
    <div data-recording-off><p>Recording is off. You can still send your note.</p><label><input type="checkbox" data-feedback-events> Record play for the lab</label></div>
    <div data-privacy-consent><p>Your browser asks not to track. This sends one run and your note without linking your history.</p><label><input type="checkbox" data-consent> Send this run with my note</label></div>
    <details><summary>What is sent</summary><p data-send-preview>Your note, optional verdict and name, with your current linked run, saves and log.</p><p>Long runs use a shorter replay: the seed and every input, without the full state.</p><a href="https://human.adamwhite.work/lab/privacy/" target="_blank" rel="noopener">Lab privacy</a></details>
    <button type="button" data-download>Keep a copy of this run</button><p data-feedback-status role="status" aria-live="polite"></p></div>
    <footer class="feedback-actions"><button type="submit" class="primary" data-send>Send</button></footer></form>
  </dialog>`;
  document.body.append(controls);
  const menu = controls.querySelector<HTMLDialogElement>('.game-menu-panel')!;
  const feedback = controls.querySelector<HTMLDialogElement>('.feedback-panel')!;
  const find = <T extends Element = HTMLElement>(selector: string) => controls.querySelector<T>(selector)!;
  const name = find<HTMLInputElement>('#valley-feedback-name');
  const note = find<HTMLTextAreaElement>('#valley-feedback-note');
  const send = find<HTMLButtonElement>('[data-send]');
  const consent = find<HTMLInputElement>('[data-consent]');
  const status = find('[data-feedback-status]');
  const feedbackRun = () => {
    try {
      return options.getRun();
    } catch {
      return undefined;
    }
  };
  const personaChoice = feedbackPersonaControl(lab);
  if (personaChoice) feedback.querySelector('textarea')?.after(personaChoice);

  let verdict = '';
  let sent = false;
  let busy = false;
  let menuOpener: HTMLElement | null = null;
  const unlinked = () => lab.privacySignalOn && !lab.privacyOverride;
  const closeMenu = () => {
    menu.close();
    menuOpener?.focus();
  };
  const closeFeedback = () => {
    feedback.close();
    menuOpener?.focus();
  };
  const sync = () => {
    const off = recordingOff();
    find<HTMLInputElement>('[data-events]').checked = !off && (!lab.privacySignalOn || lab.privacyOverride);
    find<HTMLInputElement>('[data-feedback-events]').checked = !off;
    find('[data-recording-off]').hidden = !off;
    find('[data-privacy-consent]').hidden = off || !unlinked();
    find('[data-feedback-lead]').textContent = off
      ? 'Recording is off. You can still send your note.'
      : unlinked()
        ? 'Tell us what happened. You can choose to send this run with your note.'
        : 'Send a note about this game. Recording and continuing-person choices are optional.';
    find('[data-send-preview]').textContent = off
      ? 'Your note, verdict and optional name only. No run or linked history is sent.'
      : unlinked()
        ? 'Your note, verdict and optional name. Add the run only if you select the run checkbox. This copy is unlinked.'
        : 'Your note, optional verdict and name, with your current linked run, saves and log.';
    send.disabled = !sent && busy;
    find<HTMLButtonElement>('[data-download]').disabled = !options.hasRun();
    find<HTMLButtonElement>('[data-notebook]').hidden = !options.hasRun();
    find<HTMLButtonElement>('[data-feedback]').hidden = !options.hasRun();
    find<HTMLButtonElement>('[data-title]').hidden = currentScreen === 'title';
    find('[data-menu-date]').textContent = options.hasRun() ? `· ${options.date()}` : '';
    find('[data-resume]').textContent =
      currentScreen === 'title'
        ? 'Close'
        : currentScreen === 'ending'
          ? 'Back to the gathering'
          : 'Back to the valley';
    for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-speed]'))
      button.setAttribute('aria-pressed', String(button.dataset.speed === options.getSpeed()));
  };
  syncRunControls = sync;
  showMenu = () => {
    if (feedback.open) feedback.close();
    menuOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sync();
    if (!menu.open) menu.showModal();
    void options.bindVolume().catch(() => lab.log('warn', 'Could not bind the volume on menu open.'));
  };
  showFeedback = () => {
    menu.close();
    if (!feedback.open) {
      verdict = '';
      sent = false;
      busy = false;
      note.value = '';
      name.value = readLocal(NAME_KEY);
      consent.checked = false;
      status.textContent = '';
      send.textContent = 'Send';
      for (const button of controls.querySelectorAll('[data-verdict]'))
        button.setAttribute('aria-pressed', 'false');
      sync();
      feedback.showModal();
    }
  };
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-menu]')) openMenu();
  });
  find('[data-close-menu]').addEventListener('click', closeMenu);
  find('[data-resume]').addEventListener('click', closeMenu);
  find('[data-feedback]').addEventListener('click', openFeedback);
  find('[data-close-feedback]').addEventListener('click', closeFeedback);
  find('[data-feedback-back]').addEventListener('click', openMenu);
  find('[data-notebook]').addEventListener('click', () => {
    menu.close();
    options.notebook();
  });
  find('[data-title]').addEventListener('click', async () => {
    try {
      await options.bindVolume();
    } catch {
      lab.log('warn', 'Could not bind the volume before returning to the title.');
    }
    menu.close();
    options.toTitle();
  });
  find('[data-fullscreen]').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      find('[data-fullscreen]').textContent = document.fullscreenElement
        ? 'Leave full screen'
        : 'Full screen';
    } catch {
      find('[data-fullscreen]').textContent = 'Full screen is unavailable';
    }
  });
  for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-speed]'))
    button.addEventListener('click', () => {
      options.setSpeed(button.dataset.speed as GameSpeed);
      sync();
    });
  for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-verdict]'))
    button.addEventListener('click', () => {
      verdict = verdict === button.dataset.verdict ? '' : button.dataset.verdict!;
      for (const chip of controls.querySelectorAll<HTMLButtonElement>('[data-verdict]'))
        chip.setAttribute('aria-pressed', String(chip.dataset.verdict === verdict));
    });
  find('[data-download]').addEventListener('click', options.download);
  find<HTMLInputElement>('[data-events]').addEventListener('change', (event) => {
    const on = (event.target as HTMLInputElement).checked;
    lab.setTelemetryOff(!on);
    if (lab.privacySignalOn) lab.setPrivacyOverride(on);
    sync();
  });
  find<HTMLInputElement>('[data-feedback-events]').addEventListener('change', (event) => {
    lab.setTelemetryOff(!(event.target as HTMLInputElement).checked);
    sync();
  });
  consent.addEventListener('change', sync);
  find<HTMLFormElement>('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sent) {
      closeFeedback();
      return;
    }
    if (send.disabled || busy) return;
    busy = true;
    sync();
    status.textContent = 'Sending…';
    const chosenName = name.value.trim().slice(0, 60);
    const text = [verdict ? `Verdict: ${verdict}.` : '', note.value.trim()].filter(Boolean).join('\n\n');
    try {
      if (!recordingOff() && unlinked() && consent.checked && lab.personaRecordingAllowed) {
        const run = options.getRun();
        if (!run) throw new Error('Open a ledger before sending this run.');
        await lab.sendRun(compactRun(run), { note: text, name: chosenName });
      } else await lab.sendFeedback(text, { name: chosenName, run: feedbackRun() });
      try {
        if (chosenName) localStorage.setItem(NAME_KEY, chosenName);
        else localStorage.removeItem(NAME_KEY);
      } catch {
        /* Private storage may be unavailable. */
      }
      sent = true;
      status.textContent = 'Sent. Thank you.';
      send.textContent = 'Back to the game';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not send. Please try again.';
    } finally {
      busy = false;
      sync();
    }
  });
  for (const dialog of [menu, feedback]) {
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopPropagation();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    });
  }
  window.addEventListener('hf-lab-preference', sync);
  window.addEventListener('storage', sync);
  window.addEventListener('focus', sync);
  sync();
}

export function labScreen(screen: 'title' | 'play' | 'ending'): void {
  currentScreen = screen;
  syncRunControls?.();
  lab.screen(screen);
  if (screen === 'play') lab.milestone('run started');
  if (screen === 'ending') lab.milestone('ending reached');
}
