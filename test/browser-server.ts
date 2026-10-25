import { type ChildProcess, spawn } from 'node:child_process';

/** Each suite owns its port and Vite cache, even when other games are being tested. */
export async function startBrowserServer(cacheName: string): Promise<{
  server: ChildProcess;
  origin: string;
}> {
  const server = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { createServer } from 'vite';
      const server = await createServer({
        cacheDir: ${JSON.stringify(`node_modules/.vite-${cacheName}`)},
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await server.listen();
      console.log('VALLEY_TEST_ORIGIN=' + server.resolvedUrls.local[0]);`,
    ],
    { stdio: 'pipe' },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let output = '';
      timer = setTimeout(() => reject(new Error('Browser test server did not start')), 20000);
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Browser test server exited (${code})`)));
      server.stdout?.on('data', (chunk) => {
        output += String(chunk);
        const url = output.match(/VALLEY_TEST_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
        if (url) resolve(url);
      });
    });
    return { server, origin };
  } catch (error) {
    server.kill('SIGTERM'); // Only the exact child PID owned by this suite.
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Layout/visibility assertions need rendered copy, excluding hidden dialog content. */
export async function visibleText(locator: import('playwright-core').Locator): Promise<string> {
  // biome-ignore lint/performance/useDomNodeTextContent: Text content includes hidden dialogs and makes visibility polling pass too early.
  return locator.innerText();
}
