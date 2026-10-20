import { createLab } from '@adam0white/lab-client';
import { compactRun, type SavedGame } from '../sim/game.ts';

export const lab = createLab({ game: 'valley' });
let syncRunControls: (() => void) | undefined;

type RunControls = {
  getRun: () => SavedGame | undefined;
  hasRun: () => boolean;
  download: () => void;
  bindVolume: () => Promise<void>;
};

/** The regular event names are fixed. Only a player-approved export carries the run. */
export function mountLab(options: RunControls): void {
  if (document.getElementById('lab-controls')) return;
  const controls = document.createElement('nav');
  controls.id = 'lab-controls';
  controls.setAttribute('aria-label', 'Game menu');
  controls.innerHTML = `<details><summary>Game menu</summary><div class="game-menu-panel"><p>Your place is kept as you play. Bind a full copy so the ledger opens faster.</p><p data-run-status>Take up the seal or open the ledger before saving or sharing a run.</p><button type="button" data-run="bind">Bind this volume now</button><button type="button" data-run="download">Download this run</button><button type="button" data-run="send">Send this run to the notebook</button><label><input type="checkbox"> Anonymous play events</label><a href="https://human.adamwhite.work/lab/privacy/">Lab privacy</a></div></details>`;
  const close = () => {
    const details = controls.querySelector('details');
    if (details) details.open = false;
    controls.querySelector('summary')?.focus();
  };
  controls.querySelector('[data-run="bind"]')?.addEventListener('click', () => {
    close();
    void options.bindVolume();
  });
  controls.querySelector('[data-run="download"]')?.addEventListener('click', () => {
    close();
    options.download();
  });
  controls.querySelector('[data-run="send"]')?.addEventListener('click', () => {
    close();
    lab.openSendDialog({
      getRun: options.getRun,
      compact: (run) => compactRun(run as SavedGame),
      compactNote: 'Long runs send a shorter replay: the seed and every input, without the full state.',
    });
  });
  controls.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  syncRunControls = () => {
    const status = controls.querySelector<HTMLElement>('[data-run-status]');
    if (status) status.hidden = options.hasRun();
    for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-run]'))
      button.disabled = !options.hasRun();
  };
  syncRunControls();
  const toggle = controls.querySelector('input');
  if (toggle) {
    toggle.checked = lab.eventsOn;
    const sync = () => {
      toggle.checked = lab.eventsOn;
    };
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('change', sync);
    toggle.addEventListener('change', () => {
      lab.setEventsOff(!toggle.checked);
      toggle.checked = lab.eventsOn;
    });
  }
  document.body.prepend(controls);
}

export function labScreen(screen: 'title' | 'play' | 'ending'): void {
  syncRunControls?.();
  lab.screen(screen);
  if (screen === 'play') lab.milestone('run started');
  if (screen === 'ending') lab.milestone('ending reached');
}
