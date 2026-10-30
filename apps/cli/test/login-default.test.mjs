// `openmake-code login` fixture against the built CLI (run `npm run build --workspace=@openmake/cli` first).
// HOME points into a temporary directory, so the real ~/.openmake is never read or written; no server is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function login(home, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'login'], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const pending = [...answers];
    child.stdout.on('data', chunk => {
      out += chunk;
      // Answer each prompt only once it is shown — readline would otherwise swallow buffered lines.
      while (pending.length && out.includes(pending[0].prompt)) {
        const { prompt, reply } = pending.shift();
        out = out.slice(out.indexOf(prompt) + prompt.length);
        child.stdin.write(`${reply}\n`);
        if (!pending.length) child.stdin.end();
      }
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`login timed out: ${out}`)); }, 10000);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}

test('login offers and saves the local default server when no URL is entered', async t => {
  assert.ok(existsSync(CLI), 'build the CLI first');
  const home = mkdtempSync(join(tmpdir(), 'omk-cli-login-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const { code } = await login(home, [{ prompt: '서버 URL [http://localhost:52416]', reply: '' }, { prompt: 'API key', reply: 'omk_live_fixture' }]);
  assert.equal(code, 0);
  const saved = JSON.parse(readFileSync(join(home, '.openmake/config.json'), 'utf8'));
  assert.equal(saved.serverUrl, 'http://localhost:52416');
});
