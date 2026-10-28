import type { ChildProcess } from 'node:child_process';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBrowserServer } from './browser-server.ts';

let server: ChildProcess;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  ({ server, origin } = await startBrowserServer('unload-checkpoint'));
  browser = await chromium.launch();
}, 30000);
afterAll(async () => {
  server?.kill('SIGTERM');
  await browser?.close();
}, 30000);

// The real lifecycle hook must avoid local replay, while manual publication keeps source authority.
it('skips local exit checkpoints while keeping eligible exits and manual source refusal', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', (route) => {
      const req = route.request();
      return req.method() === 'GET' && new URL(req.url()).origin === origin
        ? route.continue()
        : route.abort();
    });
    await page.goto(origin);
    const result = await page.evaluate<{
      automatic: { localCalls: number; eligibleCalls: number; writes: number };
      manualCalls: number;
      manualStatus: string;
      writes: number;
    }>(`(async () => {
      const [{CastSession}, {newGame}] = await Promise.all([
        import('/src/ui/cast-session.ts'), import('/src/sim/game.ts')
      ]);
      const lab = {setPersonaRecording(){}, allowPersonaRecording(){}, personaRecordingAllowed:false, build(){return {}}};
      let writes=0;
      const shelf = {ready:Promise.resolve(true), enabled:true, setEnabled(){}, async request(){writes++; throw Error('unexpected write')}};
      const local = new CastSession(lab,shelf);
      local.game = newGame(7,undefined,false,true,'valley-public-2026-10');
      local.game.valley.agha.granary += 1; // Deliberate forged source, never a played state.
      const originalLocal=local.checkpoint.bind(local); let localCalls=0;
      local.checkpoint=(...args)=>{localCalls++;return originalLocal(...args)};
      local.connect(()=>{});
      const eligible = new CastSession(lab,{...shelf,enabled:false});
      eligible.game = newGame(7);
      const originalEligible=eligible.checkpoint.bind(eligible); let eligibleCalls=0;
      eligible.checkpoint=(...args)=>{eligibleCalls++;return originalEligible(...args)};
      eligible.connect(()=>{});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
      window.dispatchEvent(new Event('pagehide'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve(); await Promise.resolve();
      const automatic = {localCalls,eligibleCalls,writes};
      await local.checkpoint(true);
      return {automatic,manualCalls:localCalls,manualStatus:local.status,writes};
    })()`);
    expect(result.automatic).toEqual({ localCalls: 0, eligibleCalls: 2, writes: 0 });
    expect(result.manualCalls).toBe(1);
    expect(result.manualStatus).toContain('replay state');
    expect(result.writes).toBe(0);
  } finally {
    await page.close();
  }
});
