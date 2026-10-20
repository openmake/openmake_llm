#!/usr/bin/env node
// Trusted operator configuration: {checks:[{name:'regression',argv:['node','...'],timeoutMs:1800000}]}.
// All checks are mandatory and execute directly. Receipts never contain command arguments.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) options[args[i]] = args[i + 1];
const { ['--config']: config, ['--cwd']: cwd, ['--sha']: sha, ['--output']: output } = options;
if (!output || !cwd || !/^[a-f0-9]{40}$/.test(sha || '')) {
    console.error('Required: --config PATH --cwd DIR --sha FULL_SHA --output PATH');
    process.exit(1);
}
const evidence = { schemaVersion: 1, stage: 'staging-validation', sha, status: 'failed', checks: [], startedAt: new Date().toISOString() };
let interrupted = false, abortActive;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; abortActive?.(); });

function run(check) {
    return new Promise(resolve => {
        const child = spawn(check.argv[0], check.argv.slice(1), {
            cwd, stdio: 'inherit', shell: false, detached: true,
            env: { ...process.env, OMK_VALIDATION_SHA: sha },
        });
        let exitCode = null, signal = null, errorCode, timedOut = false, stopping = false, killTimer;
        const killGroup = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
        const finish = () => {
            clearTimeout(timeout); clearTimeout(killTimer); abortActive = undefined;
            resolve({ exitCode, signal, timedOut, ...(errorCode ? { errorCode } : {}) });
        };
        const stop = () => {
            if (stopping) return;
            stopping = true;
            killGroup('SIGTERM');
            // Keep the group deadline even if its leader exits before its children.
            killTimer = setTimeout(() => { killGroup('SIGKILL'); finish(); }, 100);
        };
        const timeout = setTimeout(() => { timedOut = true; stop(); }, check.timeoutMs ?? 1_800_000);
        abortActive = stop;
        child.on('error', error => { errorCode = error.code || 'SPAWN_FAILED'; stop(); });
        child.on('close', (code, sig) => { exitCode = code; signal = sig; stop(); });
    });
}
try {
    const settings = JSON.parse(readFileSync(config, 'utf8'));
    if (!Array.isArray(settings.checks) || !settings.checks.length) throw new Error('Configure at least one mandatory validation check');
    const names = new Set();
    for (const check of settings.checks) {
        if (typeof check.name !== 'string' || !check.name.trim() || names.has(check.name) || !Array.isArray(check.argv) || !check.argv.length || check.argv.some(a => typeof a !== 'string') || !check.argv[0]) throw new Error('Each check needs a unique name and a nonempty argv string array');
        if (check.timeoutMs !== undefined && (!Number.isInteger(check.timeoutMs) || check.timeoutMs < 100 || check.timeoutMs > 1_800_000)) throw new Error('Check timeoutMs must be between 100 and 1800000');
        names.add(check.name);
    }
    for (const check of settings.checks) {
        if (interrupted) break;
        const startedAt = new Date().toISOString();
        const result = await run(check);
        evidence.checks.push({ name: check.name, status: result.exitCode === 0 && !result.errorCode && !result.timedOut && !interrupted ? 'passed' : 'failed', ...result, startedAt, finishedAt: new Date().toISOString() });
    }
    evidence.status = !interrupted && evidence.checks.length === settings.checks.length && evidence.checks.every(c => c.status === 'passed') ? 'passed' : 'failed';
} catch (error) { evidence.error = error.message; console.error(`Validation blocked: ${error.message}`); }
evidence.finishedAt = new Date().toISOString();
mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
writeFileSync(temporary, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
renameSync(temporary, output);
process.exitCode = evidence.status === 'passed' ? 0 : 1;
