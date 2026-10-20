#!/usr/bin/env node
'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */ // Plain Node CLI run by setup scripts before any build.
// Docker Desktop → Homebrew Docker CLI + dedicated Colima reconciliation for one macOS user.
// Used by scripts/setup/mac-host-repair.sh (check/apply) and install_mac.sh. Never logs credentials
// or credential helper output; on any credential failure the original config.json is left untouched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const DESKTOP_MARK = '/Docker.app/';
const DESKTOP_HELPER_DIR = '/Applications/Docker.app/Contents/Resources/bin';
const DESKTOP_PLUGIN_DIR = '/Applications/Docker.app/Contents/Resources/cli-plugins';
const SYSTEM_PLUGIN_DIRS = ['/usr/local/lib/docker/cli-plugins', '/usr/local/libexec/docker/cli-plugins', '/usr/lib/docker/cli-plugins', '/usr/libexec/docker/cli-plugins'];
const RC_BEGIN = '# >>> OpenMake Docker CLI PATH >>>';
const RC_END = '# <<< OpenMake Docker CLI PATH <<<';
const SHIM_RELATIVE = '.local/share/openmake/docker-bin';
const PATH_FILE_RELATIVE = '.config/openmake/docker-path.sh';
const SHIM_HEADER = '# Managed by OpenMake scripts/setup/mac-host-repair.sh: Docker CLI only; rerun it instead of editing.';
const SHIM_TOOLS = ['docker', 'docker-credential-osxkeychain'];
const AGENT_LABEL = 'com.openmake.colima';
const PROFILE = 'openmake';
// The agent runs the installed boot guard (scripts/setup/colima-boot-guard.sh, copied to --guard by 30-toolchain.sh):
// /bin/bash <guard> <colima> openmake [kept flags]. The two inline guards below are what earlier releases wrote;
// they are recognised only to upgrade them (they cannot recover stale Lima pid files after an unclean shutdown).
const GUARD_SHELL = '/bin/bash';
const COLIMA_GUARD = '[ -f "$COLIMA_HOME/$1/colima.yaml" ] || { echo "OpenMake Colima profile $1 is missing under $COLIMA_HOME; not starting (no replacement VM)" >&2; exit 78; }; exec "$0" start --profile "$1" --activate=false';
// Used instead when a known start flag is kept: the profile and flags follow as "$@".
const COLIMA_GUARD_WITH_FLAGS = '[ -f "$COLIMA_HOME/$1/colima.yaml" ] || { echo "OpenMake Colima profile $1 is missing under $COLIMA_HOME; not starting (no replacement VM)" >&2; exit 78; }; exec "$0" start --profile "$@" --activate=false';
// Start flags of known earlier agents that are carried over (and only these).
const KEPT_START_FLAGS = ['--save-config=false'];
const AGENT_SYSTEM_PATH = ':/usr/bin:/bin:/usr/sbin:/sbin';
const LEGACY_DOCKER_CLI_DIR = '/usr/local/bin'; // Docker Desktop's CLI links, used by earlier installer agents
const PRESERVED = 'existing Docker configuration was preserved';

let sequence = 0;
const stamp = () => `${Date.now()}-${process.pid}-${++sequence}`;
const executable = file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
const isSymlink = file => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };
const linkTarget = file => { try { return fs.readlinkSync(file); } catch { return null; } };
const realPath = file => { try { return fs.realpathSync(file); } catch { return file; } };
// A file belongs to Docker Desktop when it is, links to, or resolves into Docker.app.
const desktopOwned = file => [file, linkTarget(file) || '', realPath(file)].some(p => p.includes(DESKTOP_MARK));
// A plugin directory is Desktop's when its path or its real location is inside Docker.app.
const desktopDir = d => typeof d === 'string' && (d.includes(DESKTOP_MARK) || realPath(d).includes(DESKTOP_MARK));
const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

const pluginName = file => file.slice('docker-'.length).replace(/\.exe$/, '');
function pluginFiles(dir) {
    try { return fs.readdirSync(dir).filter(n => n.startsWith('docker-')); } catch { return []; }
}
const allPluginNames = dir => pluginFiles(dir).map(pluginName);
// Plugins that keep working without Docker Desktop.
const pluginNames = dir => pluginFiles(dir).filter(n => !desktopOwned(path.join(dir, n))).map(pluginName);

function standaloneKeychainHelper(brewPrefix) {
    const file = path.join(brewPrefix, 'bin', 'docker-credential-osxkeychain');
    if (!fs.existsSync(file) && !linkTarget(file)) return { file: null, reason: 'missing' };
    if (desktopOwned(file)) return { file: null, reason: 'desktop' };
    return executable(file) ? { file, reason: null } : { file: null, reason: 'missing' };
}

function desktopHelper(brewPrefix, dirs) {
    return [path.join(brewPrefix, 'bin'), ...dirs].map(d => path.join(d, 'docker-credential-desktop')).find(executable) || null;
}

function keychainHelperError(reason, brewPrefix) {
    return reason === 'desktop'
        ? `${brewPrefix}/bin/docker-credential-osxkeychain belongs to Docker Desktop; the Homebrew docker-credential-helper formula must own it (remove the Desktop link, then 'brew link docker-credential-helper'). ${PRESERVED}.`
        : `Homebrew docker-credential-osxkeychain is missing; run 'brew install docker-credential-helper' (or mac-host-repair.sh --apply). ${PRESERVED}.`;
}

// Credential helper protocol: action as argv, payload on stdin. Output is never surfaced.
function helperCall(file, action, input) {
    const r = spawnSync(file, [action], { input, encoding: 'utf8', timeout: 30_000 });
    return { ok: !r.error && r.status === 0, stdout: r.stdout || '', notFound: /credentials not found/i.test(`${r.stdout || ''}${r.stderr || ''}`) };
}
function parseRecord(text) {
    try { const v = JSON.parse(text); return typeof v?.Username === 'string' && typeof v?.Secret === 'string' ? v : null; } catch { return null; }
}

// null = known absent ("credentials not found"); any other failure stops the migration.
function readRecord(file, registry, what) {
    const got = helperCall(file, 'get', `${registry}\n`);
    if (!got.ok) {
        if (got.notFound) return null;
        throw new Error(`${what} failed; ${PRESERVED}. No credentials were logged.`);
    }
    const record = parseRecord(got.stdout);
    if (!record) throw new Error(`${what} returned an unreadable record; ${PRESERVED}. No credentials were logged.`);
    return record;
}
function listRecords(file, what) {
    const listed = helperCall(file, 'list', '');
    let records = null;
    try { records = listed.ok ? JSON.parse(listed.stdout) : null; } catch { /* reported below */ }
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error(`${what} failed; ${PRESERVED}. No credentials were logged.`);
    return records;
}

function planConfig(config, { brewPrefix, dockerDir, systemPluginDirs }) {
    const next = structuredClone(config);
    const findings = [];
    const credHelpers = next.credHelpers && typeof next.credHelpers === 'object' ? next.credHelpers : {};
    const desktopGlobal = next.credsStore === 'desktop';
    const desktopRegistries = Object.keys(credHelpers).filter(k => credHelpers[k] === 'desktop').sort();
    if (desktopGlobal) {
        next.credsStore = 'osxkeychain';
        findings.push({ kind: 'fix', message: 'credsStore "desktop" → "osxkeychain" after copying and verifying Desktop credentials' });
    }
    for (const registry of desktopRegistries) {
        credHelpers[registry] = 'osxkeychain';
        findings.push({ kind: 'fix', message: `credHelpers["${registry}"] "desktop" → "osxkeychain" after copying and verifying its credential` });
    }

    const brewPlugins = path.join(brewPrefix, 'lib/docker/cli-plugins');
    const dirs = Array.isArray(next.cliPluginsExtraDirs) ? next.cliPluginsExtraDirs : [];
    const kept = dirs.filter(d => !desktopDir(d));
    for (const d of dirs) if (!kept.includes(d)) findings.push({ kind: 'fix', message: `remove Desktop plugin directory ${d} from cliPluginsExtraDirs` });
    if (!kept.includes(brewPlugins)) { kept.push(brewPlugins); findings.push({ kind: 'fix', message: `add Homebrew plugin directory ${brewPlugins} to cliPluginsExtraDirs` }); }
    next.cliPluginsExtraDirs = kept;

    // A hook is Desktop's only when its plugin ships in a Desktop plugin directory or user link
    // and no other plugin directory provides the same name.
    const userPlugins = path.join(dockerDir, 'cli-plugins');
    const userPluginsLinked = isSymlink(userPlugins);
    const pluginLinks = [];
    if (userPluginsLinked) {
        findings.push({ kind: 'info', message: `${userPlugins} is a symbolic link; it was neither followed nor changed` });
    } else {
        let entries = [];
        try { entries = fs.readdirSync(userPlugins); } catch { /* no user plugin directory */ }
        for (const name of entries.sort()) {
            const file = path.join(userPlugins, name); const target = linkTarget(file);
            if (target !== null && desktopOwned(file)) {
                pluginLinks.push({ file, target });
                findings.push({ kind: 'fix', message: `remove Desktop plugin link ${file} -> ${target}` });
            }
        }
    }
    const desktopDirs = [DESKTOP_PLUGIN_DIR, ...dirs.filter(desktopDir)];
    const desktopNames = new Set([...desktopDirs.flatMap(allPluginNames), ...pluginLinks.map(l => pluginName(path.basename(l.file)))]);
    const available = new Set([brewPlugins, userPlugins, ...kept.filter(d => typeof d === 'string'), ...systemPluginDirs].flatMap(pluginNames));
    let removedHook = false;
    if (next.plugins && typeof next.plugins === 'object') {
        for (const [name, settings] of Object.entries(next.plugins)) {
            if (!settings || typeof settings !== 'object' || settings.hooks === undefined || !desktopNames.has(name) || available.has(name)) continue;
            delete settings.hooks; removedHook = true;
            if (!Object.keys(settings).length) delete next.plugins[name];
            findings.push({ kind: 'fix', message: `remove hooks of plugin "${name}" (provided only by Docker Desktop)` });
        }
        if (!Object.keys(next.plugins).length) delete next.plugins;
    }
    const hooksLeft = Object.values(next.plugins || {}).some(s => s && typeof s === 'object' && s.hooks !== undefined);
    if (removedHook && !hooksLeft && next.features && next.features.hooks !== undefined) {
        delete next.features.hooks;
        if (!Object.keys(next.features).length) delete next.features;
        findings.push({ kind: 'fix', message: 'remove features.hooks (no plugin hooks remain)' });
    }

    if (typeof next.currentContext === 'string' && next.currentContext.startsWith('desktop-')) {
        findings.push({ kind: 'info', message: `currentContext "${next.currentContext}" left unchanged; OpenMake commands select the dedicated Colima socket themselves` });
    }

    const keychain = standaloneKeychainHelper(brewPrefix);
    const migrating = desktopGlobal || desktopRegistries.length > 0;
    const usesKeychain = next.credsStore === 'osxkeychain' || Object.values(credHelpers).includes('osxkeychain');
    let needsKeychainHelper = false;
    if (usesKeychain && keychain.reason) {
        if (migrating && keychain.reason === 'missing') {
            needsKeychainHelper = true;
            findings.push({ kind: 'fix', message: 'install missing Homebrew formula docker-credential-helper (no upgrades)' });
        } else {
            findings.push({ kind: 'manual', message: keychainHelperError(keychain.reason, brewPrefix) });
        }
    }
    return { next, findings, desktopGlobal, desktopRegistries, pluginLinks, needsKeychainHelper };
}

function migrateCredentials(config, plan, { brewPrefix, desktopHelperDirs }) {
    const source = desktopHelper(brewPrefix, desktopHelperDirs);
    if (!source) throw new Error(`Docker Desktop credential helper (docker-credential-desktop) not found; keep Docker Desktop installed until its credentials are migrated. ${PRESERVED}.`);
    const keychain = standaloneKeychainHelper(brewPrefix);
    if (!keychain.file) throw new Error(keychainHelperError(keychain.reason, brewPrefix));

    const sourceList = listRecords(source, 'Docker Desktop credential list');
    const targetList = listRecords(keychain.file, 'Keychain credential list (is the login keychain unlocked?)');
    // Registries explicitly assigned to another helper keep their own backend; Desktop's global copy is ignored.
    // Explicit Desktop registries are read directly: a source list may be incomplete.
    const helpers = config.credHelpers && typeof config.credHelpers === 'object' ? config.credHelpers : {};
    const effective = new Set(plan.desktopRegistries);
    if (plan.desktopGlobal) for (const registry of [...Object.keys(sourceList), ...Object.keys(targetList)]) if (helpers[registry] === undefined) effective.add(registry);

    // Read and compare everything first so a collision stops the run before any keychain write.
    const pending = [];
    for (const registry of [...effective].sort()) {
        const credential = readRecord(source, registry, `Docker Desktop credential for ${registry}`);
        const existing = readRecord(keychain.file, registry, `Keychain lookup for ${registry} (is the login keychain unlocked?)`);
        if (!credential && existing) {
            throw new Error(`Keychain holds a credential for ${registry} that Docker Desktop does not; switching would start using it. Resolve it manually (docker logout ${registry}) and rerun. ${PRESERVED}.`);
        }
        if (credential && existing && (existing.Username !== credential.Username || existing.Secret !== credential.Secret)) {
            throw new Error(`Keychain already holds a different credential for ${registry}; refusing to overwrite it. Resolve it manually (docker logout/login ${registry}) and rerun. ${PRESERVED}.`);
        }
        if (credential) pending.push({ registry, credential, stored: Boolean(existing) });
    }
    for (const { registry, credential, stored } of pending) {
        if (stored) continue;
        const record = { ServerURL: registry, Username: credential.Username, Secret: credential.Secret };
        if (!helperCall(keychain.file, 'store', JSON.stringify(record)).ok) throw new Error(`Keychain store for ${registry} failed; ${PRESERVED}. No credentials were logged.`);
        const verify = helperCall(keychain.file, 'get', `${registry}\n`);
        const back = verify.ok ? parseRecord(verify.stdout) : null;
        if (!back || back.Username !== record.Username || back.Secret !== record.Secret) throw new Error(`Keychain verification for ${registry} failed; ${PRESERVED}.`);
    }
    return pending.map(p => p.registry);
}

function reconcileDockerConfig({ configPath, brewPrefix, apply = false, desktopHelperDirs, systemPluginDirs = SYSTEM_PLUGIN_DIRS }) {
    const exists = fs.existsSync(configPath);
    const original = exists ? fs.readFileSync(configPath, 'utf8') : '{}';
    let config;
    try { config = JSON.parse(original); } catch { throw new Error(`${configPath} is not valid JSON; it was not modified.`); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${configPath} is not a JSON object; it was not modified.`);
    const dockerDir = path.dirname(configPath);
    const plan = planConfig(config, { brewPrefix, dockerDir, systemPluginDirs });
    const configChanged = JSON.stringify(config) !== JSON.stringify(plan.next);
    const changed = configChanged || plan.pluginLinks.length > 0;
    const result = { changed, findings: plan.findings, needsKeychainHelper: plan.needsKeychainHelper, migrated: [] };
    if (!changed || !apply) return result;

    const dirs = desktopHelperDirs ?? [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), DESKTOP_HELPER_DIR];
    if (plan.desktopGlobal || plan.desktopRegistries.length) result.migrated = migrateCredentials(config, plan, { brewPrefix, desktopHelperDirs: dirs });

    fs.mkdirSync(dockerDir, { recursive: true });
    if (configChanged) {
        if (exists) {
            result.backup = `${configPath}.before-colima-${stamp()}`;
            fs.writeFileSync(result.backup, original, { mode: 0o600, flag: 'wx' });
        }
        const temporary = `${configPath}.colima-${stamp()}`;
        try {
            fs.writeFileSync(temporary, `${JSON.stringify(plan.next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, configPath);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    if (plan.pluginLinks.length) {
        result.linkBackup = path.join(dockerDir, `cli-plugins.before-colima-${stamp()}.txt`);
        fs.writeFileSync(result.linkBackup, plan.pluginLinks.map(l => `${path.basename(l.file)} -> ${l.target}\n`).join(''), { mode: 0o600, flag: 'wx' });
        for (const link of plan.pluginLinks) fs.unlinkSync(link.file);
    }
    return result;
}

// Future terminal sessions: one private directory that holds only Homebrew's docker (and its
// keychain helper) goes first on PATH. Node, other tools and every Docker/Colima variable stay as they are.
function writeDockerShim({ home, brewPrefix, apply = true }) {
    const bin = path.join(brewPrefix, 'bin');
    const shim = path.join(home, SHIM_RELATIVE);
    const pathFile = path.join(home, PATH_FILE_RELATIVE);
    const refuse = reason => { throw new Error(`refusing to change the Docker CLI PATH: ${reason}; nothing was changed.`); };
    const docker = path.join(bin, 'docker');
    if (!executable(docker)) refuse(`${docker} is missing (brew install docker)`);
    if (desktopOwned(docker)) refuse(`${docker} belongs to Docker Desktop`);
    const wanted = SHIM_TOOLS.filter(name => name === 'docker' || (executable(path.join(bin, name)) && !desktopOwned(path.join(bin, name))));

    if (isSymlink(shim) || (fs.existsSync(shim) && !fs.statSync(shim).isDirectory())) refuse(`${shim} is not a plain directory`);
    let present = [];
    try { present = fs.readdirSync(shim); } catch { /* created below */ }
    const links = [];
    for (const name of present) {
        const file = path.join(shim, name);
        if (!wanted.includes(name)) refuse(`${file} is not managed by OpenMake`);
        if (linkTarget(file) !== path.join(bin, name)) refuse(`${file} is not a link to ${path.join(bin, name)}`);
    }
    for (const name of wanted) if (!present.includes(name)) links.push(name);

    const pathText = [
        SHIM_HEADER,
        `case ":$PATH:" in *:${shellQuote(shim)}:*) ;; *) PATH=${shellQuote(shim)}:"$PATH"; export PATH ;; esac`,
        '',
    ].join('\n');
    const writes = [];
    const currentPath = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8') : null;
    if (currentPath !== null && !currentPath.startsWith(`${SHIM_HEADER}\n`)) refuse(`${pathFile} is not managed by OpenMake`);
    if (currentPath !== pathText) writes.push({ file: pathFile, text: pathText, mode: 0o600 });

    const block = `${RC_BEGIN}\nif [ -r ${shellQuote(pathFile)} ]; then . ${shellQuote(pathFile)}; fi\n${RC_END}\n`;
    const rcFiles = ['.zshrc', ...(fs.existsSync(path.join(home, '.bash_profile')) ? ['.bash_profile'] : [])];
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escape(RC_BEGIN)}\\n[\\s\\S]*?${escape(RC_END)}\\n?`);
    for (const name of rcFiles) {
        const file = path.join(home, name);
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const text = pattern.test(current) ? current.replace(pattern, () => block) : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${block}`;
        if (text !== current) writes.push({ file, text, backup: fs.existsSync(file) });
    }

    if (apply) {
        fs.mkdirSync(shim, { recursive: true, mode: 0o700 });
        for (const name of links) fs.symlinkSync(path.join(bin, name), path.join(shim, name));
        for (const w of writes) {
            fs.mkdirSync(path.dirname(w.file), { recursive: true, mode: 0o700 });
            if (w.backup) {
                const backup = `${w.file}.before-colima-${stamp()}`;
                fs.copyFileSync(w.file, backup, fs.constants.COPYFILE_EXCL); fs.chmodSync(backup, 0o600);
            }
            const mode = w.mode ?? (fs.existsSync(w.file) ? fs.statSync(w.file).mode & 0o777 : 0o644);
            fs.writeFileSync(w.file, w.text, { mode });
        }
    }
    return { changed: links.length > 0 || writes.length > 0, files: [...links.map(n => path.join(shim, n)), ...writes.map(w => w.file)] };
}

// Compares the Colima LaunchAgent with the one contract the installer writes; never touches launchd.
// Earlier installer output is 'stale' (rewritten); any other difference is 'conflict' (reported, kept).
// Settings kept from a migratable agent come back as logPath/errPath/startFlags/home for the shell writer.
function inspectColimaAgent({ plistPath, colima, colimaHome, brewPrefix, ownerHome, guard }) {
    const none = { logPath: null, errPath: null, startFlags: [], home: null };
    if (!fs.existsSync(plistPath)) return { state: 'missing', reasons: [`${plistPath} does not exist`], ...none };
    let p;
    try { p = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch {
        return { state: 'conflict', reasons: [`${plistPath} could not be parsed`], ...none };
    }
    const conflict = []; const stale = [];
    const known = ['Label', 'ProgramArguments', 'EnvironmentVariables', 'RunAtLoad', 'StandardOutPath', 'StandardErrorPath'];
    const extra = Object.keys(p).filter(k => !known.includes(k));
    if (extra.length) conflict.push(`custom keys ${extra.join(', ')}`);
    if (p.Label !== AGENT_LABEL) conflict.push(`Label is ${p.Label}`);
    const args = Array.isArray(p.ProgramArguments) ? p.ProgramArguments : [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let startFlags = [];
    const bootGuarded = flags => args.length === 4 + flags.length && args[0] === GUARD_SHELL && typeof guard === 'string' && args[1] === guard && args[3] === PROFILE && same(args.slice(4), flags);
    const inlineGuarded = (text, flags) => same(args.slice(0, 3), ['/bin/sh', '-c', text]) && args.length === 5 + flags.length && args[4] === PROFILE && same(args.slice(5), flags);
    if (bootGuarded([]) || bootGuarded(KEPT_START_FLAGS)) {
        startFlags = args.slice(4);
        if (args[2] !== colima) stale.push(`program ${args[2]} is not ${colima}`);
    } else if (inlineGuarded(COLIMA_GUARD, []) || inlineGuarded(COLIMA_GUARD_WITH_FLAGS, KEPT_START_FLAGS)) {
        startFlags = args.slice(5);
        stale.push('earlier inline guard (replaced by the boot guard that recovers stale Lima pid files)');
    } else if (args.length === 5 && same(args.slice(1), ['start', '--profile', PROFILE, '--activate=false'])) {
        stale.push('earlier unguarded colima start (starts even when the Colima storage is missing)');
    } else if (same(args.slice(1), ['start', PROFILE, ...KEPT_START_FLAGS])) {
        startFlags = [...KEPT_START_FLAGS];
        stale.push(`earlier unguarded colima start ${PROFILE} ${KEPT_START_FLAGS.join(' ')} (kept; guard and --activate=false added)`);
    } else conflict.push(`custom arguments ${args.join(' ')}`);
    const env = p.EnvironmentVariables && typeof p.EnvironmentVariables === 'object' ? p.EnvironmentVariables : {};
    const extraEnv = Object.keys(env).filter(k => k !== 'COLIMA_HOME' && k !== 'PATH' && k !== 'HOME');
    if (extraEnv.length) conflict.push(`custom launchd environment ${extraEnv.join(', ')}`);
    // HOME is kept only when it is the owner's own home.
    if (env.HOME !== undefined && (!ownerHome || env.HOME !== ownerHome)) conflict.push(`HOME ${env.HOME} is not the owner's home`);
    if (env.COLIMA_HOME === undefined) stale.push('COLIMA_HOME is not set');
    else if (String(env.COLIMA_HOME).replace(/\/$/, '') !== colimaHome) conflict.push(`COLIMA_HOME ${env.COLIMA_HOME} differs from discovered ${colimaHome}`);
    const bin = path.join(brewPrefix, 'bin'); const colimaBin = path.dirname(colima);
    const agentPath = String(env.PATH ?? '');
    const wantedPath = `${colimaBin}${colimaBin === bin ? '' : `:${bin}`}${AGENT_SYSTEM_PATH}`;
    // Earlier installers wrote "<colima dir>[:<docker CLI dir>]<system>"; only those known docker CLI dirs are migratable.
    // Any other entry belongs to the operator and must not be dropped.
    const generated = agentPath.match(new RegExp(`^([^:]+)(?::([^:]+))?${AGENT_SYSTEM_PATH.replace(/[/]/g, '\\/')}$`));
    const knownDockerDir = d => d === undefined || d === bin || d === LEGACY_DOCKER_CLI_DIR || d.includes(DESKTOP_MARK);
    // The first entry is the directory of the colima that agent ran (args[3] guarded, args[0] earlier start).
    const agentColima = args[0] === '/bin/sh' ? args[3] : args[0] === GUARD_SHELL ? args[2] : args[0];
    const knownColimaDir = d => d === colimaBin || d === bin || (typeof agentColima === 'string' && d === path.dirname(agentColima));
    if (!generated || !knownColimaDir(generated[1]) || !knownDockerDir(generated[2])) conflict.push(`custom PATH ${agentPath}`);
    else if (agentPath !== wantedPath) stale.push(agentPath.includes(DESKTOP_MARK) ? 'PATH includes Docker.app' : `PATH ${agentPath} is not ${wantedPath}`);
    if (p.RunAtLoad !== true) conflict.push('RunAtLoad is not true');
    // Existing stdout/stderr paths are kept as they are (separate files included).
    if (!p.StandardOutPath || !p.StandardErrorPath) stale.push('log path is not set for both stdout and stderr');
    const state = conflict.length ? 'conflict' : stale.length ? 'stale' : 'healthy';
    const logPath = p.StandardOutPath || null;
    return { state, reasons: conflict.length ? conflict : stale, logPath, errPath: p.StandardErrorPath || logPath, startFlags, home: env.HOME === undefined ? null : env.HOME };
}

module.exports = { reconcileDockerConfig, writeDockerShim, inspectColimaAgent };

// CLI — exit 0: nothing pending (or applied), 1: pending changes or manual items, 2: error.
function options(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--apply') o.apply = true;
        else if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
    }
    return o;
}
// Same lookup as the docker CLI: DOCKER_CONFIG, else ~/.docker.
const defaultConfigPath = () => path.join(process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'), 'config.json');
function printFindings(findings, applied) {
    for (const f of findings) console.log(`${applied && f.kind === 'fix' ? 'applied' : f.kind}: ${f.message}`);
    return findings.some(f => f.kind === 'manual');
}
if (require.main === module) {
    const [command, ...rest] = process.argv.slice(2); const o = options(rest);
    try {
        if (command === 'config') {
            const r = reconcileDockerConfig({ configPath: o.config || defaultConfigPath(), brewPrefix: o['brew-prefix'], apply: Boolean(o.apply) });
            const manual = printFindings(r.findings, Boolean(o.apply));
            if (r.migrated.length) console.log(`ok: migrated and verified ${r.migrated.length} Desktop credential record(s) into the login keychain`);
            if (r.backup) console.log(`ok: backup ${r.backup}`);
            if (r.linkBackup) console.log(`ok: removed plugin links recorded in ${r.linkBackup}`);
            process.exitCode = manual || (r.changed && !o.apply) ? 1 : 0;
        } else if (command === 'needs-keychain-helper') {
            process.exitCode = reconcileDockerConfig({ configPath: o.config || defaultConfigPath(), brewPrefix: o['brew-prefix'] }).needsKeychainHelper ? 0 : 1;
        } else if (command === 'shim') {
            const r = writeDockerShim({ home: o.home || os.homedir(), brewPrefix: o['brew-prefix'], apply: Boolean(o.apply) });
            for (const file of r.files) console.log(`${o.apply ? 'ok: updated' : 'fix: update'} ${file}`);
            process.exitCode = r.changed && !o.apply ? 1 : 0;
        } else if (command === 'agent') {
            const r = inspectColimaAgent({ plistPath: o.plist, colima: o.colima, colimaHome: o['colima-home'], brewPrefix: o['brew-prefix'], ownerHome: o['owner-home'], guard: o.guard });
            console.log(`state=${r.state}`); console.log(`log=${r.logPath || ''}`); console.log(`err=${r.errPath || ''}`);
            console.log(`flags=${r.startFlags.join(' ')}`); console.log(`home=${r.home || ''}`);
            for (const reason of r.reasons) console.log(`reason=${reason}`);
        } else {
            console.error('usage: docker-config-reconcile.cjs config|needs-keychain-helper|shim|agent [options]');
            process.exitCode = 2;
        }
    } catch (error) { console.error(`error: ${error.message}`); process.exitCode = 2; }
}
