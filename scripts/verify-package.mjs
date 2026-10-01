import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const toolchain = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
if (toolchain.error) throw toolchain.error;
assert.equal(toolchain.status, 0);
assert.equal(toolchain.stdout.trim(), '8.15.9', 'Run via pnpm dlx --package=pnpm@8.15.9 pnpm test:package');
const scratch = await mkdtemp('/private/var/folders/j0/z47723n9415_rggx8q_4rnww0000gn/T/opencode/iframe-consumer-');
const baseline = process.argv.includes('--baseline');
const name = baseline ? '@evilkiwi/iframe' : '@devlsh/iframe';
function run(command, args, cwd = scratch) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}
function pnpm(args, cwd) {
  run('pnpm', args, cwd);
}
const suppliedTarball = process.argv.find(arg => arg.startsWith('--tarball='))?.slice('--tarball='.length);
if (!suppliedTarball) pnpm(['pack', '--pack-destination', scratch], root);
const tarball =
  suppliedTarball ??
  join(
    scratch,
    (await readdir(scratch)).find(file => file.endsWith('.tgz')),
  );
const packed = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
assert.equal(packed.status, 0);
const manifest = JSON.parse(packed.stdout);
assert.equal(manifest.name, name, 'packed identity');
assert.equal(manifest.version, '1.0.3');
assert.equal(manifest.license, 'GPL-3.0-only');
assert.equal(manifest.author.name, 'Evil Kiwi Limited');
if (!baseline) {
  assert.equal(manifest.peerDependencies.react, '^18.2.0');
  assert.equal(manifest.dependencies?.['react-dom'], undefined);
  assert.equal(manifest.homepage, 'https://github.com/devlsh/iframe');
  assert.equal(manifest.bugs.url, 'https://github.com/devlsh/iframe/issues');
  assert.equal(manifest.repository.url, 'git+https://github.com/devlsh/iframe.git');
}
await writeFile(
  join(scratch, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      [name]: `file:${tarball}`,
      'react': '18.2.0',
      'react-dom': '18.2.0',
      '@types/react': '18.2.46',
      '@types/react-dom': '18.2.18',
      '@types/scheduler': '0.16.8',
      'typescript': '5.3.3',
      'esbuild': '0.18.20',
    },
  }),
);
pnpm(['install', '--ignore-scripts'], scratch);
const require = createRequire(join(scratch, 'package.json'));
const installed = dirname(require.resolve(`${name}/package.json`));
assert.deepEqual(await readFile(join(installed, 'LICENSE')), await readFile(join(root, 'LICENSE')));
const cjs = require(name);
const esm = await import(pathToFileURL(join(installed, manifest.module)));
assert.equal(typeof cjs.useIFrame, 'function');
assert.equal(typeof esm.useIFrame, 'function');
assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
await writeFile(
  join(scratch, 'types.ts'),
  `import { useIFrame } from '${name}';
import type { UseIFrameOptions } from '${name}/build/types.js';
import { createRef, type RefObject } from 'react';
const frame: RefObject<HTMLIFrameElement> = createRef<HTMLIFrameElement>();
const options: UseIFrameOptions = { mode: 'host', id: 'consumer', frame, remote: 'http://localhost' };
const api = useIFrame(options);
const result: Promise<number> = api.send<{ value: number }, number>('double', { value: 2 });
const connected: boolean = api.connected;
api.handle<{ value: number }>('double', value => value.value * 2);
api.listen<string>('event', value => value.toUpperCase());
api.emit('event', 'hello');
void result; void connected;
`,
);
run(process.execPath, [
  require.resolve('typescript/bin/tsc'),
  '--noEmit',
  '--strict',
  '--target',
  'ES2020',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  join(scratch, 'types.ts'),
]);
console.log('PASS packed identity, license, native CJS/ESM and complete declaration tree', scratch);

const fixture = `import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useIFrame } from '${name}/build/index.mjs';
const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function test(name, run) { try { await run(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: error.message }); } }
const frame = document.createElement('iframe');
frame.src = '/child?remote=' + encodeURIComponent(location.origin + '/parent');
document.body.append(frame);
await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
let api;
let events = 0;
const root = createRoot(document.getElementById('app'));
function Host() {
  api = useIFrame({ mode: 'host', id: 'consumer', frame: { current: frame }, remote: frame.src, timeout: 100 });
  useEffect(() => api.listen('event', () => events++), []);
  return React.createElement('p', null, api.connected ? 'Connected' : 'Connecting');
}
root.render(React.createElement(Host));
await test('mounted host/client handshake', async () => {
  for (let i = 0; i < 100 && !api?.connected; i++) await wait(20);
  check(api?.connected, 'handshake did not connect');
});
await test('bidirectional real postMessage events', async () => {
  api.emit('echo-event', { value: 1 }); await wait(100);
  check(events === 1, 'event response not received');
});
await test('async response and remote errors', async () => {
  check(await api.send('double', { value: 3 }) === 6, 'wrong async result');
  let message; try { await api.send('error', {}); } catch (error) { message = error.message; }
  check(message === 'remote failure', 'remote error not preserved');
});
await test('request timeout and handler removal', async () => {
  let message; try { await api.send('missing', {}, 30); } catch (error) { message = error.message; }
  check(message === 'Request timed out.', 'missing request did not time out');
  check(await api.send('remove', {}) === true, 'handler removal failed');
  try { await api.send('double', { value: 3 }, 30); throw new Error('removed handler answered'); }
  catch (error) { check(error.message === 'Request timed out.', error.message); }
});
await test('wrong channel ignored', async () => {
  const before = events;
  frame.contentWindow.postMessage({ command: 'wrong-channel' }, location.origin); await wait(100);
  check(events === before, 'wrong channel reached event listener');
});
await test('incoming origin rejection', async () => {
  const observed = [];
  const observe = event => {
    if (event.data?.id === 'consumer' && event.data?.type === 'event') observed.push({ origin: event.origin, data: event.data, fromFrame: event.source === frame.contentWindow });
  };
  window.addEventListener('message', observe);
  const before = events;
  frame.contentWindow.postMessage({ command: 'event' }, location.origin); await wait(100);
  check(events === before + 1, 'configured origin did not reach event listener');
  frame.sandbox = 'allow-scripts'; frame.src = '/attacker';
  await new Promise(resolve => frame.addEventListener('load', resolve, { once: true })); await wait(100);
  window.removeEventListener('message', observe);
  const after = events;
  frame.removeAttribute('sandbox'); frame.src = '/child?remote=' + encodeURIComponent(location.origin + '/parent');
  await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  check(observed.length === 2, 'native origin controls not received');
  check(observed[0].origin === location.origin && observed[1].origin === 'null', 'origin controls were not distinct');
  check(observed.every(event => event.fromFrame), 'origin controls did not come from the same DOM iframe: ' + JSON.stringify(observed));
  const body = event => JSON.stringify([event.data.id, event.data.type, event.data.payload]);
  check(body(observed[0]) === body(observed[1]), 'origin controls changed the message body');
  check(after === before + 1, 'foreign opaque origin reached event listener despite remote origin');
});
await test('client incoming origin rejection', async () => {
  const before = events;
  api.emit('echo-event', {}); await wait(100);
  check(events === before + 1, 'configured parent origin did not reach client');
  const attacker = document.createElement('iframe'); attacker.src = '/attacker?client'; attacker.sandbox = 'allow-scripts';
  document.body.append(attacker);
  await new Promise(resolve => attacker.addEventListener('load', resolve, { once: true })); await wait(100);
  attacker.remove();
  check(events === before + 1, 'foreign opaque origin reached client event listener despite configured parent');
});
await test('default wildcard preserves unrestricted receive', async () => {
  let open, received = 0;
  const node = document.createElement('div'); document.body.append(node);
  const owner = createRoot(node);
  function OpenClient({ remote }) {
    open = useIFrame({ mode: 'client', id: 'open', remote });
    useEffect(() => open.listen('wildcard-event', () => received++), []);
    return React.createElement('p', null, open.connected ? 'Open' : 'Connecting');
  }
  try {
  owner.render(React.createElement(OpenClient));
  for (let i = 0; i < 100 && !open?.connected; i++) await wait(20);
  const attacker = document.createElement('iframe'); attacker.src = '/attacker?wildcard'; attacker.sandbox = 'allow-scripts';
  document.body.append(attacker);
  await new Promise(resolve => attacker.addEventListener('load', resolve, { once: true })); await wait(100);
  attacker.remove();
  check(received === 1, 'default wildcard receive behavior changed');
  owner.render(React.createElement(OpenClient, { remote: '/' })); await wait(100);
  open.emit('wildcard-event', {}); await wait(100);
  check(received === 2, 'same-origin shorthand did not accept the local sender');
  const foreign = document.createElement('iframe'); foreign.src = '/attacker?wildcard'; foreign.sandbox = 'allow-scripts';
  document.body.append(foreign);
  await new Promise(resolve => foreign.addEventListener('load', resolve, { once: true })); await wait(100);
  foreign.remove();
  check(received === 2, 'configured same-origin shorthand retained stale wildcard authorization');
  for (const remote of ['not-a-url', 'data:text/html,ignored']) {
    owner.render(React.createElement(OpenClient, { remote })); await wait(100);
    open.emit('wildcard-event', {}); await wait(100);
    const closed = document.createElement('iframe'); closed.src = '/attacker?wildcard'; closed.sandbox = 'allow-scripts';
    document.body.append(closed);
    await new Promise(resolve => closed.addEventListener('load', resolve, { once: true })); await wait(100);
    closed.remove();
    check(received === 2, 'malformed or opaque remote authorized incoming messages: ' + remote);
  }
  } finally { owner.unmount(); node.remove(); }
});
await test('listener and unmount cleanup', async () => {
  let removed = 0; const stop = api.listen('removed', () => removed++); stop();
  frame.contentWindow.postMessage({ command: 'removed' }, location.origin); await wait(100);
  check(removed === 0, 'unregistered listener ran');
  const before = events; root.unmount();
  frame.contentWindow.postMessage({ command: 'event' }, location.origin); await wait(100);
  check(events === before, 'unmounted listener ran');
});
frame.remove();
document.getElementById('result').textContent = JSON.stringify(results, null, 2);
await fetch('/result', { method: 'POST', body: JSON.stringify(results) });
`;
const child = `import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useIFrame } from '${name}/build/index.mjs';
function Client() {
  const api = useIFrame({ mode: 'client', id: 'consumer', remote: new URLSearchParams(location.search).get('remote') ?? '*' });
  useEffect(() => {
    const stop = api.handle('double', value => value.value * 2);
    api.handle('error', () => { throw new Error('remote failure'); });
    api.handle('remove', () => { stop(); return true; });
    api.listen('echo-event', payload => api.emit('event', payload));
    const commands = event => {
      if (event.data?.command === 'wrong-channel') parent.postMessage({ id: 'other', type: 'event', payload: {} }, location.origin);
      if (event.data?.command === 'removed') api.emit('removed', {});
      if (event.data?.command === 'event') api.emit('event', {});
    };
    window.addEventListener('message', commands);
    return () => window.removeEventListener('message', commands);
  }, []);
  return React.createElement('p', null, 'Client');
}
createRoot(document.getElementById('app')).render(React.createElement(Client));
`;
await writeFile(join(scratch, 'fixture.mjs'), fixture);
await writeFile(join(scratch, 'child.mjs'), child);
const { build } = require('esbuild');
for (const entry of ['fixture', 'child'])
  await build({
    entryPoints: [join(scratch, `${entry}.mjs`)],
    outfile: join(scratch, `${entry}.js`),
    bundle: true,
    format: 'esm',
    target: 'es2022',
  });
const html = entry => `<div id="app"></div><pre id="result">Running</pre><script type="module" src="/${entry}.js"></script>`;
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/result' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const results = JSON.parse(body);
    assert.ok(
      Array.isArray(results) &&
        results.length === 9 &&
        results.every(
          result => typeof result.name === 'string' && typeof result.ok === 'boolean' && (result.ok || typeof result.error === 'string'),
        ),
    );
    await writeFile(join(scratch, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    response.end('Recorded');
    process.exitCode = results.every(result => result.ok) ? 0 : 1;
    server.close();
  } else if (['/fixture.js', '/child.js'].includes(request.url)) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(join(scratch, request.url.slice(1))));
  } else if (request.url.startsWith('/attacker')) {
    const target = request.url === '/attacker?client' ? 'parent.frames[0]' : 'parent';
    const message =
      request.url === '/attacker?wildcard'
        ? { id: 'open', type: 'wildcard-event', payload: {} }
        : { id: 'consumer', type: request.url === '/attacker?client' ? 'echo-event' : 'event', payload: {} };
    response.end(`<script>${target}.postMessage(${JSON.stringify(message)},"*")</script>`);
  } else response.end(html(request.url.startsWith('/child') ? 'child' : 'fixture'));
});
server.listen(0, '127.0.0.1', () => console.log(`BROWSER REQUIRED: http://127.0.0.1:${server.address().port}/; evidence: ${scratch}`));
