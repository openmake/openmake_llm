#!/usr/bin/env node
// Read-only activation audit. Secret values are never requested or printed.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const CI = 'CI Gate (Test → Build → Size → Lint)';
export function readiness({ repository, secrets, branches, workflows, defaultBranchFiles = [] }) {
    const checks = [
        { name: 'automation-credential', passed: secrets.some(s => ['OMK_AUTOMATION_TOKEN', 'OMK_PROMOTE_TOKEN'].includes(s.name)) },
        ...['dev', 'main'].map(branch => ({ name: `${branch}-required-current-ci`, passed: branches[branch]?.required_status_checks?.strict === true && [...(branches[branch]?.required_status_checks?.contexts ?? []), ...(branches[branch]?.required_status_checks?.checks ?? []).map(c => c.context)].includes(CI) })),
        ...['auto-merge.yml', 'promote.yml', 'release-verified.yml'].map(file => ({ name: `default-branch-${file}`, passed: defaultBranchFiles.includes(file) && workflows.some(w => w.path === `.github/workflows/${file}` && w.state === 'active') })),
    ];
    return { schemaVersion: 1, stage: 'configuration-audit', repository, observedAt: new Date().toISOString(), status: checks.every(c => c.passed) ? 'configured' : 'blocked', checks, note: 'Configured is not execution or deployment proof. Audit tom/ome-on/bean schedules and validation separately.' };
}
function main() {
    const repo = process.argv[2];
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Usage: node scripts/pipeline/configuration.mjs OWNER/REPO');
    const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repo}${path ? `/${path}` : ''}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const defaultBranch = api('').default_branch;
    const defaultBranchFiles = ['auto-merge.yml', 'promote.yml', 'release-verified.yml'].filter(file => {
        try { return api(`contents/.github/workflows/${file}?ref=${encodeURIComponent(defaultBranch)}`).type === 'file'; } catch { return false; }
    });
    const result = readiness({ defaultBranchFiles, repository: repo, secrets: api('actions/secrets?per_page=100').secrets, branches: Object.fromEntries(['dev', 'main'].map(b => [b, api(`branches/${b}/protection`)])), workflows: api('actions/workflows?per_page=100').workflows });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'configured' ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch { console.error('Cannot audit GitHub activation: check repository name and read permissions for secrets metadata, protection and workflows. No settings changed.'); process.exitCode = 1; }
}
