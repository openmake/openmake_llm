#!/usr/bin/env node
// External scenarios only: no merge, deployment, role changes or verification writes.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CHECKS = new Set(['health', 'ready', 'login', 'chat']);
const SHA = /^[a-f0-9]{7,40}$/;
export function validateConfig(config) {
    if (!Array.isArray(config?.targets) || !config.targets.length) throw new Error('Configure at least one target');
    const ids = new Set();
    for (const target of config.targets) {
        if (!/^[a-z0-9-]+$/.test(target.id ?? '') || ids.has(target.id)) throw new Error('Target IDs must be unique names');
        ids.add(target.id);
        const url = new URL(target.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Target requires an HTTP(S) URL without credentials/query');
        if (!Array.isArray(target.checks) || !target.checks.length || target.checks.some(c => !CHECKS.has(c))) throw new Error('Configure explicit supported checks');
        if (target.expectedSha && !/^[a-f0-9]{40}$/.test(target.expectedSha)) throw new Error('expectedSha must be a full SHA');
    }
    return config;
}

export function assertChatResponse(body) {
    if (body?.success !== true || typeof body.data?.response !== 'string' || !body.data.response.trim()) throw new Error('Chat response is not a successful nonempty assistant output');
}

export async function runTarget(target, env = process.env) {
    const result = { schemaVersion: 1, stage: 'bean', target: target.id, baseUrl: target.baseUrl, sha: null, version: null, status: 'failed', checks: [], startedAt: new Date().toISOString() };
    let csrf, cookie;
    const request = async (path, options = {}) => {
        const response = await fetch(new URL(path, target.baseUrl), { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response;
    };
    const identity = async () => {
        const response = await request('/health');
        const doc = await response.json();
        const build = doc.data?.build ?? doc.build;
        if (!SHA.test(build?.gitHash ?? '') || !build?.version) throw new Error('Installed identity unavailable');
        return { sha: build.gitHash, version: build.version };
    };
    const login = async () => {
        if (cookie) return;
        if (!env[target.emailEnv] || !env[target.passwordEnv]) throw new Error('Account environment variables missing');
        const doc = await (await request('/api/csrf-token')).json();
        if (typeof doc.token !== 'string' || !/^[\w.-]+$/.test(doc.token)) throw new Error('CSRF token unavailable');
        csrf = doc.token;
        const response = await request('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `csrf_token=${csrf}` },
            body: JSON.stringify({ email: env[target.emailEnv], password: env[target.passwordEnv] }),
        });
        const auth = response.headers.getSetCookie().map(c => /^auth_token=([^;]+)/.exec(c)?.[1]).find(Boolean);
        if (!auth || /[\r\n;]/.test(auth)) throw new Error('Login did not return an authentication cookie');
        cookie = `auth_token=${auth}; csrf_token=${csrf}`;
    };
    try {
        validateConfig({ targets: [target] });
        const initial = await identity();
        Object.assign(result, initial, { identityPrecision: initial.sha.length === 40 ? 'full-sha' : 'short-sha' });
        if (target.expectedSha && !target.expectedSha.startsWith(initial.sha)) throw new Error('Installed identity differs from expected SHA');
        for (const check of target.checks) {
            const startedAt = new Date().toISOString();
            try {
                if (check === 'health') await identity();
                if (check === 'ready') await request('/ready');
                if (check === 'login') await login();
                if (check === 'chat') {
                    await login();
                    const response = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ message: 'Reply with OK.' }) });
                    assertChatResponse(await response.json());
                }
                result.checks.push({ name: check, status: 'passed', startedAt, finishedAt: new Date().toISOString() });
            } catch (error) {
                result.checks.push({ name: check, status: 'failed', startedAt, finishedAt: new Date().toISOString(), error: error.message });
                throw error;
            }
        }
        const final = await identity();
        if (final.sha !== initial.sha || final.version !== initial.version) throw new Error('Installed identity changed during scenarios');
        result.status = 'passed';
    } catch (error) { result.error = error.message; }
    result.finishedAt = new Date().toISOString();
    return result;
}

export function scheduleArgs(config, output, cron) {
    if (typeof cron !== 'string' || cron.trim().split(/\s+/).length !== 5) throw new Error('Explicit five-field cron is required');
    return ['start', process.execPath, '--name', 'omk-bean', '--no-autorestart', '--cron-restart', cron, '--time', '--', fileURLToPath(import.meta.url), 'run', '--config', resolve(config), '--output', resolve(output)];
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        if (!['--config', '--output', '--every'].includes(args[i]) || !args[i + 1]) throw new Error('Use run|schedule --config PATH --output DIR [--every CRON]');
        options[args[i]] = args[i + 1];
    }
    if (!['run', 'schedule'].includes(command) || !options['--config'] || !options['--output']) throw new Error('Use run|schedule --config PATH --output DIR [--every CRON]');
    const config = validateConfig(JSON.parse(readFileSync(options['--config'], 'utf8')));
    if (command === 'schedule') {
        const child = spawnSync('pm2', scheduleArgs(options['--config'], options['--output'], options['--every']), { stdio: 'inherit', shell: false });
        if (child.status !== 0) throw new Error('PM2 schedule registration failed');
        return;
    }
    const receipt = { schemaVersion: 1, stage: 'bean', startedAt: new Date().toISOString(), targets: [] };
    for (const target of config.targets) receipt.targets.push(await runTarget(target));
    receipt.status = receipt.targets.every(t => t.status === 'passed') ? 'passed' : 'failed';
    receipt.finishedAt = new Date().toISOString();
    mkdirSync(options['--output'], { recursive: true });
    const path = resolve(options['--output'], `bean-${Date.now()}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, path);
    console.log(`bean ${receipt.status}: ${path}`);
    process.exitCode = receipt.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
