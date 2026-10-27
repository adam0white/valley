import { createLab, FEEDBACK_LABELS } from '@adam0white/lab-client';
import { feedbackPersonaControl, feedbackSharePlay } from '@adam0white/lab-kit';
import type { SavedGame } from '../sim/game.ts';
import { toggleMusic } from './music.ts';

export const FOREIGN_FILE = new URLSearchParams(location.search).get('file') === '1';
export const LAB_TOOLS = new URLSearchParams(location.search).get('lab') === '1';
export const lab = createLab({
  game: 'valley',
  ...(FOREIGN_FILE ? { preservation: 'preserve' as const } : {}),
});
lab.setPersonaRecording(`valley-startup-${crypto.randomUUID()}`);
export type GameSpeed = 'automatic' | 'slow' | 'steady' | 'fast';
type RunControls = {
  getRun: () => SavedGame | undefined;
  hasRun: () => boolean;
  chooseRecording: (allow: boolean) => Promise<void>;
  download: () => void;
  bindVolume: () => Promise<void>;
  notebook: () => void;
  toTitle: () => void;
  closeFile?: () => void;
  recordingChanged?: () => void;
  newGame?: () => void;
  getSpeed: () => GameSpeed;
  setSpeed: (speed: GameSpeed) => void;
  date: () => string;
};
let syncRunControls: (() => void) | undefined;
let showMenu: (() => void) | undefined;
let showFeedback: (() => void) | undefined;
const NAME_KEY = 'hf-lab-feedback-name';
function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
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
    <div class="menu-body"><button type="button" data-music aria-pressed="false">Music: off</button><p data-save-status role="status"></p><p>Time stops while this menu is open. ${FOREIGN_FILE ? 'This file stays in this tab. Download it to keep your progress.' : 'The game saves your progress as you play.'}</p>
    ${
      LAB_TOOLS
        ? `<button type="button" data-notebook>The notebook <span aria-hidden="true">▸</span></button>
    <fieldset class="menu-speed"><legend>Time</legend><div role="group" aria-label="Time control">${(['automatic', 'slow', 'steady', 'fast'] as const).map((speed) => `<button type="button" data-speed="${speed}" aria-pressed="false">${speed.charAt(0).toUpperCase() + speed.slice(1)}</button>`).join('')}</div></fieldset>
    `
        : ''
    }<button type="button" data-feedback>Feedback <span aria-hidden="true">▸</span></button>
    <button type="button" data-fullscreen>Full screen</button>
    <button type="button" data-new${FOREIGN_FILE ? ' hidden disabled' : ''}>New game</button>${FOREIGN_FILE ? '<button type="button" data-file-download>Download this Valley file</button><button type="button" data-file-open>Open another Valley file</button><button type="button" data-file-close>Close file session</button>' : ''}<span data-new-confirm hidden>Replace your saved game? <button type="button" data-confirm-new>Start new game</button><button type="button" data-cancel-new>Cancel</button></span>
    <a href="https://human.adamwhite.work/games/" target="_top">All games</a></div>
    <footer class="menu-footer"><label><input type="checkbox" data-events> Recording</label><a href="https://human.adamwhite.work/lab/privacy/" target="_blank" rel="noopener">Lab privacy</a><button type="button" class="primary" data-resume>Resume</button></footer>
  </dialog>
  <dialog class="feedback-panel" aria-labelledby="valley-feedback-title">
    <header class="feedback-head"><button type="button" data-feedback-back aria-label="Back to menu">←</button><h2 id="valley-feedback-title">Feedback</h2><button type="button" data-close-feedback aria-label="Close Feedback">×</button></header>
    <form class="feedback-form"><div class="feedback-body"><p data-feedback-lead>Send a note about this game. You can choose whether to share your play.</p>
    <div class="feedback-verdicts" role="group" aria-label="Would you keep playing?"><button type="button" data-verdict="keep" aria-pressed="false">I'd keep playing</button><button type="button" data-verdict="mixed" aria-pressed="false">Not sure</button><button type="button" data-verdict="quit" aria-pressed="false">I'd stop here</button></div>
    <div class="feedback-verdicts" role="group" aria-label="Feedback topic">${Object.entries(FEEDBACK_LABELS)
      .map(
        ([key, label]) =>
          `<button type="button" data-feedback-label="${key}" aria-pressed="false">${label}</button>`,
      )
      .join('')}</div>
    <label for="valley-feedback-note">Tell us what happened in the valley, what you wanted and what got in the way.</label><textarea id="valley-feedback-note" rows="4" maxlength="12000"></textarea>
    <label for="valley-feedback-name">Your name or tester ID <small>(optional)</small></label><input id="valley-feedback-name" type="text" maxlength="60" autocomplete="nickname"><p class="soft">A name labels your player ID and the past and future play linked to it on this device. Leave this empty to use only your player ID.</p>
    <details><summary>What is sent</summary><p data-send-preview>We send your note, your optional answer and name, and your current linked game, saves and log.</p><p>For long games, we send the starting seed and every action so the game can be replayed. We leave out the full game state.</p><a href="https://human.adamwhite.work/lab/privacy/" target="_blank" rel="noopener">Lab privacy</a></details>
    ${LAB_TOOLS ? '<button type="button" data-download>Keep a copy of this run</button>' : ''}<p data-feedback-status role="status" aria-live="polite"></p></div>
    <footer class="feedback-actions"><button type="submit" class="primary" data-send>Submit</button></footer></form>
  </dialog>`;
  document.body.append(controls);
  const music = controls.querySelector<HTMLButtonElement>('[data-music]');
  music?.addEventListener('click', async () => {
    try {
      const on = await toggleMusic();
      music.textContent = `Music: ${on ? 'on' : 'off'}`;
      music.setAttribute('aria-pressed', String(on));
    } catch {
      music.textContent = 'Music is unavailable in this browser.';
      music.setAttribute('aria-pressed', 'false');
    }
  });
  const find = <T extends Element = HTMLElement>(selector: string): T => {
    const element = controls.querySelector<T>(selector);
    if (!element) throw new Error(`Missing lab control: ${selector}`);
    return element;
  };
  const menu = find<HTMLDialogElement>('.game-menu-panel');
  const feedback = find<HTMLDialogElement>('.feedback-panel');
  const name = find<HTMLInputElement>('#valley-feedback-name');
  const note = find<HTMLTextAreaElement>('#valley-feedback-note');
  const send = find<HTMLButtonElement>('[data-send]');
  const status = find('[data-feedback-status]');
  const feedbackRun = () => {
    try {
      return options.getRun();
    } catch {
      return undefined;
    }
  };
  let personaChoice = feedbackPersonaControl(lab);
  if (personaChoice) feedback.querySelector('textarea')?.after(personaChoice);

  let feedbackLabel = '';
  let verdict = '';
  let sent = false;
  let busy = false;
  let menuOpener: HTMLElement | null = null;
  const closeMenu = () => {
    menu.close();
    menuOpener?.focus();
  };
  const closeFeedback = () => {
    feedback.close();
    menuOpener?.focus();
  };
  const sync = () => {
    options.recordingChanged?.();
    find<HTMLInputElement>('[data-events]').checked = lab.telemetryOn;
    find('[data-feedback-lead]').textContent =
      'Send a note about this game. You can choose whether to share your play.';
    find('[data-send-preview]').textContent =
      !lab.telemetryOn && !feedbackSharePlay(personaChoice)
        ? 'We send only your note, your answer and your optional name. We send no saved game or linked history.'
        : 'We send your note, your answer and your optional name. We include available game details when recording allows it.';
    send.disabled = !sent && busy;
    const download = controls.querySelector<HTMLButtonElement>('[data-download]');
    if (download) download.disabled = !options.hasRun();
    const notebook = controls.querySelector<HTMLButtonElement>('[data-notebook]');
    if (notebook) notebook.hidden = !options.hasRun();
    find('[data-menu-date]').textContent = options.hasRun() ? `· ${options.date()}` : '';
    find('[data-resume]').textContent = 'Resume';
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
      feedbackLabel = '';
      for (const button of controls.querySelectorAll('[data-feedback-label]'))
        button.setAttribute('aria-pressed', 'false');
      verdict = '';
      sent = false;
      busy = false;
      note.value = '';
      name.value = readLocal(NAME_KEY);
      status.textContent = '';
      send.textContent = 'Submit';
      for (const button of controls.querySelectorAll('[data-verdict]'))
        button.setAttribute('aria-pressed', 'false');
      personaChoice?.remove();
      personaChoice = feedbackPersonaControl(lab);
      if (personaChoice) {
        feedback.querySelector('textarea')?.after(personaChoice);
        personaChoice.addEventListener('change', sync);
      }
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
  controls.querySelector('[data-notebook]')?.addEventListener('click', () => {
    menu.close();
    options.notebook();
  });
  find('[data-new]').addEventListener('click', () => {
    if (!FOREIGN_FILE) find('[data-new-confirm]').hidden = false;
  });
  find('[data-cancel-new]').addEventListener('click', () => {
    find('[data-new-confirm]').hidden = true;
  });
  find('[data-confirm-new]').addEventListener('click', () => {
    find('[data-new-confirm]').hidden = true;
    menu.close();
    if (!FOREIGN_FILE) options.newGame?.();
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
      verdict = verdict === button.dataset.verdict ? '' : (button.dataset.verdict ?? '');
      for (const chip of controls.querySelectorAll<HTMLButtonElement>('[data-verdict]'))
        chip.setAttribute('aria-pressed', String(chip.dataset.verdict === verdict));
    });
  for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-feedback-label]'))
    button.addEventListener('click', () => {
      const previous = feedbackLabel;
      feedbackLabel = previous === button.dataset.feedbackLabel ? '' : (button.dataset.feedbackLabel ?? '');
      const oldLabel = FEEDBACK_LABELS[previous as keyof typeof FEEDBACK_LABELS];
      let text = note.value;
      if (oldLabel && text === oldLabel) text = '';
      else if (oldLabel && text.startsWith(`${oldLabel}\n\n`)) text = text.slice(oldLabel.length + 2);
      const label = FEEDBACK_LABELS[feedbackLabel as keyof typeof FEEDBACK_LABELS];
      note.value = [label, text].filter(Boolean).join('\n\n');
      for (const chip of controls.querySelectorAll<HTMLButtonElement>('[data-feedback-label]'))
        chip.setAttribute('aria-pressed', String(chip.dataset.feedbackLabel === feedbackLabel));
    });
  controls.querySelector('[data-download]')?.addEventListener('click', options.download);
  controls.querySelector('[data-file-download]')?.addEventListener('click', options.download);
  controls.querySelector('[data-file-open]')?.addEventListener('click', () => {
    menu.close();
    options.toTitle();
  });
  controls.querySelector('[data-file-close]')?.addEventListener('click', () => {
    menu.close();
    options.closeFile?.();
  });
  find<HTMLInputElement>('[data-events]').addEventListener('change', (event) => {
    const on = (event.target as HTMLInputElement).checked;
    lab.setTelemetryOff(!on);
    sync();
  });
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
      const sharePlay = feedbackSharePlay(personaChoice);
      const receipt = await lab.sendFeedback(text, { name: chosenName, run: feedbackRun(), sharePlay });
      const sentMessage = `Sent. Your note is stored. · ${receipt}`;
      try {
        if (chosenName) localStorage.setItem(NAME_KEY, chosenName);
        else localStorage.removeItem(NAME_KEY);
      } catch {
        /* Private storage may be unavailable. */
      }
      sent = true;
      status.textContent = sentMessage;
      send.textContent = 'Back to the game';
    } catch (error) {
      console.error(error);
      status.textContent =
        LAB_TOOLS && error instanceof Error
          ? error.message
          : 'Your feedback could not be sent. Please try again.';
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
  syncRunControls?.();
  lab.screen(screen);
  if (screen === 'play') lab.milestone('run started');
  if (screen === 'ending') lab.milestone('ending reached');
}
