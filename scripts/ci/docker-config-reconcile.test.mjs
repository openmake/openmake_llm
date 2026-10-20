import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync, lstatSync, statSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reconcileDockerConfig, writeDockerShim, inspectColimaAgent } = require('../setup/docker-config-reconcile.cjs');

const DESKTOP_APP = '/Applications/Docker.app/Contents/Resources';
const SECRET = 'private-secret';

// Fake credential helpers keep their records in one JSON file; every store call is recorded.
function fixture(t, config, { old, next, unlisted = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-docker-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefix = join(dir, 'brew with spaces'); mkdirSync(join(prefix, 'bin'), { recursive: true });
  const dockerDir = join(dir, 'home', '.docker'); mkdirSync(dockerDir, { recursive: true });
  const file = join(dockerDir, 'config.json'); writeFileSync(file, JSON.stringify(config));
  const state = join(dir, 'credentials.json');
  writeFileSync(state, JSON.stringify({
    old: old ?? { registry: { ServerURL: 'registry', Username: 'user', Secret: SECRET } },
    next: next ?? {}, stores: [], unlisted,
  }));
  for (const kind of ['desktop', 'osxkeychain']) {
    writeFileSync(join(prefix, 'bin', `docker-credential-${kind}`), `#!${process.execPath}
const fs=require('fs'),p=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(p));
const kind=${JSON.stringify(kind)},a=process.argv[2],input=fs.readFileSync(0,'utf8');
const store=kind==='desktop'?s.old:s.next;
if(a==='list')console.log(JSON.stringify(Object.fromEntries(Object.entries(store).filter(([k])=>kind!=='desktop'||!s.unlisted.includes(k)).map(([k,v])=>[k,v.Username]))));
if(a==='get'){const v=store[input.trim()];if(!v){console.log('credentials not found in native keychain');process.exit(1);}console.log(JSON.stringify(v));}
if(a==='store'){const v=JSON.parse(input);store[v.ServerURL]=v;s.stores.push(kind+':'+v.ServerURL);fs.writeFileSync(p,JSON.stringify(s));}
`, { mode: 0o700 });
  }
  const credentials = () => JSON.parse(readFileSync(state));
  return {
    dir, prefix, file, dockerDir, state, credentials,
    run: (apply = true) => reconcileDockerConfig({ configPath: file, brewPrefix: prefix, apply }),
  };
}
const readConfig = f => JSON.parse(readFileSync(f.file, 'utf8'));

test('migrates and verifies Desktop credentials before switching; preserves unrelated config and registry helpers', t => {
  const f = fixture(t, { credsStore: 'desktop', currentContext: 'colima-openmake', auths: { keep: { auth: 'opaque' } }, credHelpers: { registry: 'desktop', other: 'custom' }, cliPluginsExtraDirs: [`${DESKTOP_APP}/cli-plugins`, '/custom'], experimental: 'enabled' });
  const result = f.run(); const c = readConfig(f);
  assert.equal(c.credsStore, 'osxkeychain'); assert.equal(c.credHelpers.registry, 'osxkeychain'); assert.equal(c.credHelpers.other, 'custom');
  assert.deepEqual(c.auths, { keep: { auth: 'opaque' } }); assert.equal(c.currentContext, 'colima-openmake'); assert.equal(c.experimental, 'enabled');
  assert.deepEqual(c.cliPluginsExtraDirs, ['/custom', join(f.prefix, 'lib/docker/cli-plugins')]);
  assert.deepEqual(f.credentials().next.registry, f.credentials().old.registry);
  assert.deepEqual(result.migrated, ['registry']);
  assert.deepEqual(f.credentials().old.registry, { ServerURL: 'registry', Username: 'user', Secret: SECRET });
  assert.deepEqual(f.credentials().stores, ['osxkeychain:registry']);
  const backups = readdirSync(f.dockerDir).filter(n => n.startsWith('config.json.before-colima-'));
  assert.equal(backups.length, 1);
  assert.equal(statSync(join(f.dockerDir, backups[0])).mode & 0o777, 0o600);
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
});

test('helper failure preserves exact config and never includes credentials or helper output in errors', t => {
  const f = fixture(t, { credsStore: 'desktop' }); const before = readFileSync(f.file, 'utf8');
  writeFileSync(join(f.prefix, 'bin/docker-credential-osxkeychain'), `#!${process.execPath}\nconsole.log('${SECRET}');console.error('${SECRET}');process.exit(1);`, { mode: 0o700 });
  assert.throws(() => f.run(), e => !e.message.includes(SECRET) && /preserved/.test(e.message));
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

test('read-only check performs no migration; applying twice makes no further changes', t => {
  const f = fixture(t, { credsStore: 'desktop' }); const before = readFileSync(f.file, 'utf8');
  const check = f.run(false);
  assert.equal(check.changed, true); assert.ok(check.findings.some(x => x.kind === 'fix' && /credsStore/.test(x.message)));
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(f.credentials().next, {}); assert.deepEqual(readdirSync(f.dockerDir), ['config.json']);
  f.run(); const once = readFileSync(f.file, 'utf8'); assert.equal(f.run().changed, false); assert.equal(readFileSync(f.file, 'utf8'), once);
});

test('unknown credential backend is preserved and no helper is required without Desktop credentials', t => {
  const f = fixture(t, { credsStore: 'custom', currentContext: 'colima-openmake' });
  rmSync(join(f.prefix, 'bin'), { recursive: true }); f.run();
  assert.equal(readConfig(f).credsStore, 'custom');
});

test('missing old helper refuses credential migration without altering configuration', t => {
  const f = fixture(t, { credsStore: 'desktop' }); rmSync(join(f.prefix, 'bin/docker-credential-desktop'));
  const before = readFileSync(f.file, 'utf8');
  assert.throws(() => reconcileDockerConfig({ configPath: f.file, brewPrefix: f.prefix, apply: true, desktopHelperDirs: [] }), /desktop/i);
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

test('refuses to overwrite a different credential already stored in the target keychain', t => {
  const f = fixture(t, { credsStore: 'desktop' }, { next: { registry: { ServerURL: 'registry', Username: 'user', Secret: 'other-secret' } } });
  const before = readFileSync(f.file, 'utf8');
  assert.throws(() => f.run(), e => /registry/.test(e.message) && /different/.test(e.message) && !e.message.includes(SECRET) && !e.message.includes('other-secret'));
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.equal(f.credentials().next.registry.Secret, 'other-secret'); assert.deepEqual(f.credentials().stores, []);
});

test('collision is detected before any credential is stored', t => {
  const f = fixture(t, { credsStore: 'desktop' }, {
    old: { a: { ServerURL: 'a', Username: 'u', Secret: SECRET }, z: { ServerURL: 'z', Username: 'u', Secret: SECRET } },
    next: { z: { ServerURL: 'z', Username: 'u', Secret: 'different' } },
  });
  assert.throws(() => f.run(), /different/);
  assert.deepEqual(f.credentials().stores, []);
});

test('identical credential already in the target is accepted without storing again', t => {
  const f = fixture(t, { credsStore: 'desktop' }, { next: { registry: { ServerURL: 'registry', Username: 'user', Secret: SECRET } } });
  f.run();
  assert.equal(readConfig(f).credsStore, 'osxkeychain'); assert.deepEqual(f.credentials().stores, []);
});

test('target lookup errors other than not-found refuse migration', t => {
  const f = fixture(t, { credsStore: 'desktop' }); const before = readFileSync(f.file, 'utf8');
  writeFileSync(join(f.prefix, 'bin/docker-credential-osxkeychain'), `#!${process.execPath}\nconsole.log('keychain locked');process.exit(1);`, { mode: 0o700 });
  assert.throws(() => f.run(), /preserved/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

test('global Desktop records for registries explicitly assigned to another helper are not migrated', t => {
  const f = fixture(t, { credsStore: 'desktop', credHelpers: { 'custom.io': 'custom', 'keychain.io': 'osxkeychain' } }, {
    old: {
      registry: { ServerURL: 'registry', Username: 'user', Secret: SECRET },
      'custom.io': { ServerURL: 'custom.io', Username: 'u', Secret: 'desktop-copy' },
      'keychain.io': { ServerURL: 'keychain.io', Username: 'u', Secret: 'desktop-copy' },
    },
    next: { 'keychain.io': { ServerURL: 'keychain.io', Username: 'u', Secret: 'keychain-own' } },
  });
  const result = f.run();
  assert.deepEqual(result.migrated, ['registry']);
  assert.deepEqual(f.credentials().stores, ['osxkeychain:registry']);
  assert.equal(f.credentials().next['keychain.io'].Secret, 'keychain-own');
  assert.deepEqual(readConfig(f).credHelpers, { 'custom.io': 'custom', 'keychain.io': 'osxkeychain' });
});

test('per-registry Desktop helper migrates only those registries', t => {
  const f = fixture(t, { credsStore: 'custom', credHelpers: { registry: 'desktop', absent: 'desktop' } }, {
    old: { registry: { ServerURL: 'registry', Username: 'user', Secret: SECRET }, unrelated: { ServerURL: 'unrelated', Username: 'u', Secret: 'x' } },
  });
  const result = f.run();
  assert.deepEqual(result.migrated, ['registry']);
  assert.equal(f.credentials().next.unrelated, undefined);
  const c = readConfig(f);
  assert.equal(c.credsStore, 'custom'); assert.deepEqual(c.credHelpers, { registry: 'osxkeychain', absent: 'osxkeychain' });
});

test('explicit Desktop registry missing from the source list is still compared with the target before switching', t => {
  const f = fixture(t, { credsStore: 'custom', credHelpers: { gone: 'desktop' } }, {
    old: {}, next: { gone: { ServerURL: 'gone', Username: 'other', Secret: 'other-secret' } },
  });
  const before = readFileSync(f.file, 'utf8');
  assert.throws(() => f.run(), e => /gone/.test(e.message) && /preserved/.test(e.message) && !e.message.includes('other-secret'));
  assert.equal(readFileSync(f.file, 'utf8'), before); assert.deepEqual(f.credentials().stores, []);
});

test('global migration refuses a registry that only the target keychain holds', t => {
  const f = fixture(t, { credsStore: 'desktop' }, { next: { 'only-target': { ServerURL: 'only-target', Username: 'x', Secret: 'target-secret' } } });
  const before = readFileSync(f.file, 'utf8');
  assert.throws(() => f.run(), e => /only-target/.test(e.message) && !e.message.includes('target-secret'));
  assert.equal(readFileSync(f.file, 'utf8'), before); assert.deepEqual(f.credentials().stores, []);
});

test('explicit Desktop registry omitted from an incomplete source list is read directly and migrated', t => {
  const f = fixture(t, { credHelpers: { registry: 'desktop' } }, { unlisted: ['registry'] });
  const result = f.run();
  assert.deepEqual(result.migrated, ['registry']);
  assert.deepEqual(f.credentials().next.registry, f.credentials().old.registry);
  assert.equal(readConfig(f).credHelpers.registry, 'osxkeychain');
});

test('explicit Desktop registry absent from both stores switches without storing anything', t => {
  const f = fixture(t, { credHelpers: { none: 'desktop' } });
  assert.deepEqual(f.run().migrated, []);
  assert.equal(readConfig(f).credHelpers.none, 'osxkeychain'); assert.deepEqual(f.credentials().stores, []);
});

test('check reports a missing standalone keychain helper for an osxkeychain store', t => {
  const f = fixture(t, { credsStore: 'osxkeychain' }); rmSync(join(f.prefix, 'bin/docker-credential-osxkeychain'));
  const check = f.run(false);
  assert.ok(check.findings.some(x => x.kind === 'manual' && /docker-credential-helper/.test(x.message)));
});

test('Desktop-provided keychain helper does not count as the standalone helper', t => {
  const f = fixture(t, { credsStore: 'desktop' }); const before = readFileSync(f.file, 'utf8');
  const target = join(f.prefix, 'bin/docker-credential-osxkeychain'); rmSync(target);
  const fakeApp = join(f.dir, 'Docker.app/Contents/Resources/bin'); mkdirSync(fakeApp, { recursive: true });
  writeFileSync(join(fakeApp, 'docker-credential-osxkeychain'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  symlinkSync(join(fakeApp, 'docker-credential-osxkeychain'), target);
  assert.throws(() => f.run(), /docker-credential-helper/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

// Desktop lists its own plugin directory in cliPluginsExtraDirs; that is the proof a hook belongs to Desktop.
function desktopPlugins(f, names) {
  const dir = join(f.dir, 'Docker.app/Contents/Resources/cli-plugins'); mkdirSync(dir, { recursive: true });
  for (const n of names) writeFileSync(join(dir, `docker-${n}`), '', { mode: 0o700 });
  return dir;
}

test('removes only hooks of plugins proven to come from Docker Desktop', t => {
  const f = fixture(t, {});
  const desktop = desktopPlugins(f, ['debug', 'scout', 'compose']);
  writeFileSync(f.file, JSON.stringify({ cliPluginsExtraDirs: [desktop], plugins: { debug: { hooks: 'exec' }, scout: { hooks: 'pull', keep: true }, compose: { hooks: 'up' }, mine: { hooks: 'build' }, '-x-cli-hints': { enabled: 'true' } }, features: { hooks: 'true', keep: true } }));
  const brewPlugins = join(f.prefix, 'lib/docker/cli-plugins'); mkdirSync(brewPlugins, { recursive: true });
  writeFileSync(join(brewPlugins, 'docker-compose'), '', { mode: 0o700 });
  f.run(); const c = readConfig(f);
  assert.equal(c.plugins.debug, undefined); assert.deepEqual(c.plugins.scout, { keep: true });
  assert.deepEqual(c.plugins.compose, { hooks: 'up' }); assert.deepEqual(c.plugins.mine, { hooks: 'build' });
  assert.deepEqual(c.plugins['-x-cli-hints'], { enabled: 'true' });
  assert.deepEqual(c.features, { hooks: 'true', keep: true });
  assert.deepEqual(c.cliPluginsExtraDirs, [brewPlugins]);
});

test('drops the hooks feature flag once no plugin hooks remain', t => {
  const f = fixture(t, {});
  writeFileSync(f.file, JSON.stringify({ cliPluginsExtraDirs: [desktopPlugins(f, ['debug'])], plugins: { debug: { hooks: 'exec' } }, features: { hooks: 'true' } }));
  f.run(); const c = readConfig(f);
  assert.equal(c.plugins, undefined); assert.equal(c.features, undefined);
});

test('a symlinked user plugin directory is neither followed nor mutated', t => {
  const f = fixture(t, {});
  const real = join(f.dir, 'shared-plugins'); mkdirSync(real);
  symlinkSync(`${DESKTOP_APP}/cli-plugins/docker-scout`, join(real, 'docker-scout'));
  symlinkSync(real, join(f.dockerDir, 'cli-plugins'));
  const check = f.run(false);
  assert.ok(check.findings.some(x => x.kind === 'info' && /cli-plugins/.test(x.message) && /symbolic link/.test(x.message)));
  f.run();
  assert.ok(lstatSync(join(real, 'docker-scout')).isSymbolicLink());
  assert.ok(lstatSync(join(f.dockerDir, 'cli-plugins')).isSymbolicLink());
});

test('hooks stay when a shared symlinked plugin directory provides the same plugin as Docker Desktop', t => {
  const f = fixture(t, {});
  const desktop = desktopPlugins(f, ['debug']);
  const shared = join(f.dir, 'shared-plugins'); mkdirSync(shared);
  writeFileSync(join(shared, 'docker-debug'), '#!/bin/sh\n', { mode: 0o755 });
  symlinkSync(shared, join(f.dockerDir, 'cli-plugins'));
  writeFileSync(f.file, JSON.stringify({ cliPluginsExtraDirs: [desktop], plugins: { debug: { hooks: 'exec' } }, features: { hooks: 'true' } }));
  f.run(); const c = readConfig(f);
  assert.deepEqual(c.plugins, { debug: { hooks: 'exec' } }); assert.deepEqual(c.features, { hooks: 'true' });
  assert.deepEqual(readdirSync(shared), ['docker-debug']);
});

test('an extra plugin directory that is a symlink alias into Docker Desktop counts as Desktop', t => {
  const f = fixture(t, {});
  const desktop = desktopPlugins(f, ['scout']);
  const alias = join(f.dir, 'plugins-alias'); symlinkSync(desktop, alias);
  writeFileSync(f.file, JSON.stringify({ cliPluginsExtraDirs: [alias, '/custom'], plugins: { scout: { hooks: 'pull' } } }));
  f.run(); const c = readConfig(f);
  assert.deepEqual(c.cliPluginsExtraDirs, ['/custom', join(f.prefix, 'lib/docker/cli-plugins')]);
  assert.equal(c.plugins, undefined);
});

test('removes Desktop plugin links with a manifest backup and keeps other plugins', t => {
  const f = fixture(t, {});
  const links = join(f.dockerDir, 'cli-plugins'); mkdirSync(links);
  symlinkSync(`${DESKTOP_APP}/cli-plugins/docker-scout`, join(links, 'docker-scout'));
  symlinkSync('/opt/custom/docker-mine', join(links, 'docker-mine'));
  writeFileSync(join(links, 'docker-local'), '', { mode: 0o700 });
  const check = f.run(false);
  assert.ok(check.findings.some(x => x.kind === 'fix' && /docker-scout/.test(x.message)));
  assert.ok(lstatSync(join(links, 'docker-scout')).isSymbolicLink());
  f.run();
  assert.deepEqual(readdirSync(links).sort(), ['docker-local', 'docker-mine']);
  const manifest = readdirSync(f.dockerDir).find(n => n.startsWith('cli-plugins.before-colima-'));
  assert.ok(manifest);
  assert.match(readFileSync(join(f.dockerDir, manifest), 'utf8'), /docker-scout -> \/Applications\/Docker\.app/);
});

test('reports a Desktop currentContext without changing it', t => {
  const f = fixture(t, { currentContext: 'desktop-linux' });
  const check = f.run(false);
  assert.ok(check.findings.some(x => x.kind === 'info' && /desktop-linux/.test(x.message)));
  f.run(); assert.equal(readConfig(f).currentContext, 'desktop-linux');
});

test('malformed config errors are generic and leave the file untouched', t => {
  const f = fixture(t, {}); writeFileSync(f.file, `{"auths":{"r":{"auth":"${SECRET}"`);
  assert.throws(() => f.run(), e => /not valid JSON/.test(e.message) && !e.message.includes(SECRET));
  assert.equal(readFileSync(f.file, 'utf8'), `{"auths":{"r":{"auth":"${SECRET}"`);
});

test('CLI honours DOCKER_CONFIG and never prints credentials', t => {
  const f = fixture(t, { credsStore: 'desktop' });
  const cli = new URL('../setup/docker-config-reconcile.cjs', import.meta.url).pathname;
  const env = { ...process.env, HOME: join(f.dir, 'elsewhere'), DOCKER_CONFIG: f.dockerDir };
  const run = (...extra) => { try { return { code: 0, out: execFileSync(process.execPath, [cli, 'config', '--brew-prefix', f.prefix, ...extra], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  const check = run();
  assert.equal(check.code, 1); assert.match(check.out, /credsStore/);
  assert.equal(readConfig(f).credsStore, 'desktop');
  const applied = run('--apply');
  assert.equal(applied.code, 0, applied.out); assert.equal(readConfig(f).credsStore, 'osxkeychain');
  assert.match(applied.out, /^applied: credsStore/m); assert.doesNotMatch(applied.out, /^fix:/m);
  assert.ok(!`${check.out}${applied.out}`.includes(SECRET));
  assert.equal(existsSync(join(f.dir, 'elsewhere')), false);
});

// Fresh login shells: one Docker-only shim directory ahead of PATH; Node and every Docker variable untouched.
function shimFixture(t, { homeName = "home with 'quote' & space" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-shim-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, homeName); mkdirSync(home);
  const prefix = join(dir, 'brew'); const bin = join(prefix, 'bin'); mkdirSync(bin, { recursive: true });
  for (const name of ['docker', 'docker-credential-osxkeychain', 'node', 'npm', 'npx', 'colima']) writeFileSync(join(bin, name), `#!/bin/sh\necho brew-${name}\n`, { mode: 0o755 });
  const nodeDir = join(dir, 'node24/bin'); mkdirSync(nodeDir, { recursive: true });
  writeFileSync(join(nodeDir, 'node'), '#!/bin/sh\necho v24.21.0\n', { mode: 0o755 });
  return { dir, home, prefix, bin, nodeDir, shim: join(home, '.local/share/openmake/docker-bin'), pathFile: join(home, '.config/openmake/docker-path.sh') };
}
const freshShell = (f, env = {}) => execFileSync('/bin/sh', ['-c',
  `. "$1"; . "$1"; printf '%s|%s|%s|%s|%s|%s' "$PATH" "$(command -v node)" "$(command -v docker)" "\${DOCKER_CONTEXT-unset}" "\${DOCKER_HOST-unset}" "\${COLIMA_HOME-unset}"`, 'sh', f.pathFile],
  { encoding: 'utf8', env: { PATH: `${f.nodeDir}:${f.bin}:/usr/bin:/bin`, ...env } }).split('|');

test('Docker shim links only Homebrew docker and the keychain helper; fresh shells keep Node and Docker env', t => {
  const f = shimFixture(t);
  writeFileSync(join(f.home, '.zshrc'), '# existing\nexport KEEP=yes\n');
  const opts = { home: f.home, brewPrefix: f.prefix };
  assert.equal(writeDockerShim({ ...opts, apply: false }).changed, true);
  assert.equal(existsSync(f.shim), false); assert.equal(existsSync(f.pathFile), false);
  assert.equal(readFileSync(join(f.home, '.zshrc'), 'utf8'), '# existing\nexport KEEP=yes\n');
  assert.equal(writeDockerShim(opts).changed, true);
  assert.equal(writeDockerShim(opts).changed, false);
  assert.deepEqual(readdirSync(f.shim).sort(), ['docker', 'docker-credential-osxkeychain']);
  for (const name of readdirSync(f.shim)) assert.equal(readlinkSync(join(f.shim, name)), join(f.bin, name));
  const rc = readFileSync(join(f.home, '.zshrc'), 'utf8');
  assert.ok(rc.startsWith('# existing\nexport KEEP=yes\n')); assert.equal(rc.match(/>>> OpenMake Docker CLI PATH >>>/g).length, 1);
  assert.equal(existsSync(join(f.home, '.bash_profile')), false);
  const backup = readdirSync(f.home).find(n => n.startsWith('.zshrc.before-colima-'));
  assert.ok(backup); assert.equal(statSync(join(f.home, backup)).mode & 0o777, 0o600);
  const text = readFileSync(f.pathFile, 'utf8');
  assert.doesNotMatch(text, /DOCKER_HOST|DOCKER_CONTEXT|COLIMA_HOME|unset|export DOCKER/);
  const [pathValue, node, docker, context, host, colimaHome] = freshShell(f, { DOCKER_CONTEXT: 'colima', DOCKER_HOST: 'unix:///buzz.sock' });
  assert.equal(pathValue, `${f.shim}:${f.nodeDir}:${f.bin}:/usr/bin:/bin`);
  assert.equal(node, join(f.nodeDir, 'node')); assert.equal(docker, join(f.shim, 'docker'));
  assert.deepEqual([context, host, colimaHome], ['colima', 'unix:///buzz.sock', 'unset']);
});

test('Docker shim joins an existing bash profile, keeps the keychain helper optional and updates its block in place', t => {
  const f = shimFixture(t, { homeName: 'home' });
  rmSync(join(f.bin, 'docker-credential-osxkeychain'));
  writeFileSync(join(f.home, '.zshrc'), 'before\n'); writeFileSync(join(f.home, '.bash_profile'), 'bash\n');
  writeDockerShim({ home: f.home, brewPrefix: f.prefix });
  assert.deepEqual(readdirSync(f.shim), ['docker']);
  writeFileSync(join(f.home, '.zshrc'), readFileSync(join(f.home, '.zshrc'), 'utf8') + 'after\n');
  writeFileSync(join(f.bin, 'docker-credential-osxkeychain'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(writeDockerShim({ home: f.home, brewPrefix: f.prefix }).changed, true);
  assert.deepEqual(readdirSync(f.shim).sort(), ['docker', 'docker-credential-osxkeychain']);
  const rc = readFileSync(join(f.home, '.zshrc'), 'utf8');
  assert.equal(rc.match(/>>> OpenMake Docker CLI PATH >>>/g).length, 1); assert.ok(rc.startsWith('before\n')); assert.ok(rc.endsWith('after\n'));
  assert.match(readFileSync(join(f.home, '.bash_profile'), 'utf8'), /^bash\n[\s\S]*OpenMake Docker CLI PATH/);
});

test('Docker shim rc block is replaced literally even when the home path contains $& or $\'', t => {
  const f = shimFixture(t, { homeName: "h $& $' $` x" });
  writeFileSync(join(f.home, '.zshrc'), 'before\n');
  writeDockerShim({ home: f.home, brewPrefix: f.prefix });
  const once = readFileSync(join(f.home, '.zshrc'), 'utf8');
  writeFileSync(f.pathFile, readFileSync(f.pathFile, 'utf8')); // unchanged content
  writeFileSync(join(f.home, '.zshrc'), once.replace('if [', 'if  ['));
  writeDockerShim({ home: f.home, brewPrefix: f.prefix });
  assert.equal(readFileSync(join(f.home, '.zshrc'), 'utf8'), once);
  assert.equal(writeDockerShim({ home: f.home, brewPrefix: f.prefix }).changed, false);
});

test('Docker shim does not link a keychain helper owned by Docker Desktop', t => {
  const f = shimFixture(t, { homeName: 'home' });
  const app = join(f.dir, 'Docker.app/Contents/Resources/bin'); mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'docker-credential-osxkeychain'), '#!/bin/sh\n', { mode: 0o755 });
  rmSync(join(f.bin, 'docker-credential-osxkeychain')); symlinkSync(join(app, 'docker-credential-osxkeychain'), join(f.bin, 'docker-credential-osxkeychain'));
  writeDockerShim({ home: f.home, brewPrefix: f.prefix });
  assert.deepEqual(readdirSync(f.shim), ['docker']);
});

test('Docker shim refuses conflicting shim entries, foreign PATH files and Desktop-owned docker without writing', t => {
  const cases = {
    'regular file in shim': f => { mkdirSync(f.shim, { recursive: true }); writeFileSync(join(f.shim, 'docker'), 'custom'); },
    'link to another docker': f => { mkdirSync(f.shim, { recursive: true }); symlinkSync('/usr/local/bin/docker', join(f.shim, 'docker')); },
    'unrelated tool in shim': f => { mkdirSync(f.shim, { recursive: true }); symlinkSync(join(f.bin, 'node'), join(f.shim, 'node')); },
    'shim directory is a link': f => { mkdirSync(join(f.home, '.local/share/openmake'), { recursive: true }); symlinkSync(f.bin, f.shim); },
    'unmanaged PATH file': f => { mkdirSync(join(f.home, '.config/openmake'), { recursive: true }); writeFileSync(f.pathFile, 'PATH=/mine:$PATH\n'); },
    'Desktop docker': f => {
      const app = join(f.dir, 'Docker.app/Contents/Resources/bin'); mkdirSync(app, { recursive: true });
      writeFileSync(join(app, 'docker'), '#!/bin/sh\n', { mode: 0o755 }); rmSync(join(f.bin, 'docker')); symlinkSync(join(app, 'docker'), join(f.bin, 'docker'));
    },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const f = shimFixture(t, { homeName: name });
    writeFileSync(join(f.home, '.zshrc'), 'keep\n'); arrange(f);
    const before = readdirSync(f.home, { recursive: true }).sort();
    assert.throws(() => writeDockerShim({ home: f.home, brewPrefix: f.prefix }), /refus|Docker Desktop/, name);
    assert.throws(() => writeDockerShim({ home: f.home, brewPrefix: f.prefix, apply: false }), /refus|Docker Desktop/, name);
    assert.equal(readFileSync(join(f.home, '.zshrc'), 'utf8'), 'keep\n', name);
    assert.deepEqual(readdirSync(f.home, { recursive: true }).sort(), before, name);
  }
});

const GUARD = '[ -f "$COLIMA_HOME/$1/colima.yaml" ] || { echo "OpenMake Colima profile $1 is missing under $COLIMA_HOME; not starting (no replacement VM)" >&2; exit 78; }; exec "$0" start --profile "$1" --activate=false';
const xml = v => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const GUARD_WITH_FLAGS = '[ -f "$COLIMA_HOME/$1/colima.yaml" ] || { echo "OpenMake Colima profile $1 is missing under $COLIMA_HOME; not starting (no replacement VM)" >&2; exit 78; }; exec "$0" start --profile "$@" --activate=false';
function plist(t, { colima = '/opt/homebrew/bin/colima', home = '/Volumes/MAC_APP/Colima', path = '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', extraEnv = '', args, stdout = '/Users/x/.openmake/logs/colima.log', stderr = '/Users/x/.openmake/logs/colima.log' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-agent-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'com.openmake.colima.plist');
  const argv = args ?? ['/bin/sh', '-c', GUARD, colima, 'openmake'];
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.openmake.colima</string>
<key>ProgramArguments</key><array>${argv.map(a => `<string>${xml(a)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict><key>COLIMA_HOME</key><string>${home}</string><key>PATH</key><string>${path}</string>${extraEnv}</dict>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${stdout}</string>
${stderr === null ? '' : `<key>StandardErrorPath</key><string>${stderr}</string>`}
</dict></plist>
`);
  return file;
}
const expected = { colima: '/opt/homebrew/bin/colima', colimaHome: '/Volumes/MAC_APP/Colima', brewPrefix: '/opt/homebrew', ownerHome: '/Users/x' };
const LEGACY_ARGS = ['/opt/homebrew/bin/colima', 'start', '--profile', 'openmake', '--activate=false'];

test('agent inspection uses the installer contract: guarded start, exact environment, one log', { skip: process.platform !== 'darwin' && 'plutil is macOS only' }, t => {
  const state = opts => inspectColimaAgent({ plistPath: plist(t, opts), ...expected });
  assert.equal(inspectColimaAgent({ plistPath: '/nonexistent/x.plist', ...expected }).state, 'missing');
  const healthy = state({});
  assert.equal(healthy.state, 'healthy'); assert.equal(healthy.logPath, '/Users/x/.openmake/logs/colima.log');
  // Earlier installer output is ours and is upgraded
  assert.equal(state({ args: LEGACY_ARGS }).state, 'stale');
  assert.equal(state({ path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' }).state, 'stale');
  const desktopPath = state({ path: `/opt/homebrew/bin:${DESKTOP_APP}/bin:/usr/bin:/bin:/usr/sbin:/sbin` });
  assert.equal(desktopPath.state, 'stale'); assert.match(desktopPath.reasons.join(' '), /Docker\.app/);
  assert.equal(state({ colima: '/usr/local/bin/colima', path: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' }).state, 'stale');
  assert.equal(state({ stderr: null }).state, 'stale');
  // Only the PATH shapes earlier installers generated are migratable (docker CLI dir: /usr/local/bin or Docker.app)
  assert.equal(state({ args: LEGACY_ARGS, path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' }).state, 'stale');
  assert.equal(state({ args: LEGACY_ARGS, path: `/opt/homebrew/bin:${DESKTOP_APP}/bin:/usr/bin:/bin:/usr/sbin:/sbin` }).state, 'stale');
  // Anything else is a custom setting: reported, never replaced
  for (const [name, opts] of Object.entries({
    'custom PATH': { path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
    'other COLIMA_HOME': { home: '/Users/x/.colima' },
    'extra env': { extraEnv: '<key>DOCKER_CONTEXT</key><string>colima</string>' },
    'stop instead of start': { args: ['/opt/homebrew/bin/colima', 'stop', '--profile', 'openmake', '--activate=false'] },
    'reordered arguments': { args: ['/opt/homebrew/bin/colima', 'start', '--activate=false', '--profile', 'openmake'] },
    'extra argument': { args: [...LEGACY_ARGS, '--cpu', '8'] },
    // An unrecognised middle PATH entry is the operator's, even in an otherwise generated shape: never dropped.
    'legacy start with custom middle PATH': { args: LEGACY_ARGS, path: '/opt/homebrew/bin:/opt/company/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    'guarded start with custom middle PATH': { path: '/opt/homebrew/bin:/opt/company/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    'custom first PATH entry': { args: LEGACY_ARGS, path: '/opt/company/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
  })) {
    const r = state(opts);
    assert.equal(r.state, 'conflict', name);
  }
  assert.match(state({ home: '/Users/x/.colima' }).reasons.join(' '), /COLIMA_HOME/);
});

// The exact earlier hand-made agent seen on a host: positional profile, --save-config=false, HOME, separate logs.
const ONLINE_ARGS = ['/opt/homebrew/bin/colima', 'start', 'openmake', '--save-config=false'];
const onlineAgent = { args: ONLINE_ARGS, path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  extraEnv: '<key>HOME</key><string>/Users/x</string>', stdout: '/Users/x/Library/Logs/colima-openmake.log', stderr: '/Users/x/Library/Logs/colima-openmake.error.log' };

test('known legacy agent migrates keeping --save-config=false, owner HOME, external Colima and both logs', { skip: process.platform !== 'darwin' && 'plutil is macOS only' }, t => {
  const r = inspectColimaAgent({ plistPath: plist(t, onlineAgent), ...expected });
  assert.equal(r.state, 'stale', r.reasons.join('; '));
  assert.deepEqual(r.startFlags, ['--save-config=false']); assert.equal(r.home, '/Users/x');
  assert.equal(r.logPath, '/Users/x/Library/Logs/colima-openmake.log'); assert.equal(r.errPath, '/Users/x/Library/Logs/colima-openmake.error.log');
  // What the writer produces from that is healthy (repeat apply is a no-op)
  const migrated = inspectColimaAgent({ plistPath: plist(t, { ...onlineAgent, args: ['/bin/sh', '-c', GUARD_WITH_FLAGS, '/opt/homebrew/bin/colima', 'openmake', '--save-config=false'], path: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }), ...expected });
  assert.equal(migrated.state, 'healthy', migrated.reasons.join('; ')); assert.deepEqual(migrated.startFlags, ['--save-config=false']);
  // Separate stdout/stderr on the standard agent are kept, not a conflict
  const logs = inspectColimaAgent({ plistPath: plist(t, { stderr: '/tmp/other.log' }), ...expected });
  assert.equal(logs.state, 'healthy'); assert.equal(logs.errPath, '/tmp/other.log'); assert.deepEqual(logs.startFlags, []); assert.equal(logs.home, null);
});

test('near-miss legacy agents stay manual', { skip: process.platform !== 'darwin' && 'plutil is macOS only' }, t => {
  for (const [name, opts] of Object.entries({
    'extra start argument': { ...onlineAgent, args: [...ONLINE_ARGS, '--cpu', '4'] },
    'other save-config value': { ...onlineAgent, args: ['/opt/homebrew/bin/colima', 'start', 'openmake', '--save-config=true'] },
    'other profile': { ...onlineAgent, args: ['/opt/homebrew/bin/colima', 'start', 'other', '--save-config=false'] },
    'flags reordered': { ...onlineAgent, args: ['/opt/homebrew/bin/colima', 'start', '--save-config=false', 'openmake'] },
    'HOME of another user': { ...onlineAgent, extraEnv: '<key>HOME</key><string>/Users/y</string>' },
    'extra environment': { ...onlineAgent, extraEnv: '<key>HOME</key><string>/Users/x</string><key>DOCKER_HOST</key><string>unix:///x</string>' },
    'custom PATH': { ...onlineAgent, path: '/opt/homebrew/bin:/opt/company/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    'guarded with unknown flag': { args: ['/bin/sh', '-c', GUARD_WITH_FLAGS, '/opt/homebrew/bin/colima', 'openmake', '--cpu=4'] },
    'flag guard without flag': { args: ['/bin/sh', '-c', GUARD_WITH_FLAGS, '/opt/homebrew/bin/colima', 'openmake'] },
  })) {
    assert.equal(inspectColimaAgent({ plistPath: plist(t, opts), ...expected }).state, 'conflict', name);
  }
});
