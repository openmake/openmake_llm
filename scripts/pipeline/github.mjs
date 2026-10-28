import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function requireToken(env = process.env) {
    const token = env.OMK_AUTOMATION_TOKEN || env.OMK_PROMOTE_TOKEN;
    if (!token) {
        throw new Error('Set OMK_AUTOMATION_TOKEN to a GitHub App or PAT credential; GITHUB_TOKEN cannot trigger downstream CI. OMK_PROMOTE_TOKEN is accepted for migration.');
    }
    return token;
}
export function latestCI(runs, sha) {
    const latest = runs.filter(r => r.head_sha === sha).sort((a, b) => b.id - a.id || (b.run_attempt || 1) - (a.run_attempt || 1))[0];
    return latest?.conclusion === 'success';
}
export function eligiblePull(pr, sha, repo) {
    return pr.state === 'open' && !pr.draft && pr.head.sha === sha && pr.head.repo?.full_name === repo && pr.base.ref === 'dev' && /^(feature|feat|fix|docs|chore|test|refactor)\/.+/.test(pr.head.ref);
}
export function metadataOnly(before, after, path, allowed, lockWorkspaces = []) {
    if (before === null || after === null || !allowed.has(path)) {
        return false;
    }
    if (path === 'CHANGELOG.md') {
        return true;
    }
    try {
        const a = JSON.parse(before), b = JSON.parse(after);
        if (path === '.release-please-manifest.json') {
            return Object.keys(a).sort().join() === Object.keys(b).sort().join() && Object.values(b).every(v => semver(v));
        }
        const strip = o => {
            const c = structuredClone(o);
            delete c.version;
            if (path === 'package-lock.json') {
                for (const ws of ['', ...lockWorkspaces]) {
                    delete c.packages?.[ws]?.version;
                }
            }
            return JSON.stringify(c);
        };
        const workspaceVersions = path === 'package-lock.json' ? lockWorkspaces.map(ws => b.packages?.[ws]?.version).filter(v => v !== undefined) : [];
        return semver(b.version) && workspaceVersions.every(v => semver(v)) && strip(a) === strip(b);
    }
    catch {
        return false;
    }
}
const semver = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function blob(ref, path) {
    try {
        return git('show', `${ref}:${path}`);
    }
    catch {
        return null;
    }
}
export function metadataRange(base, head) {
    const config = JSON.parse(git('show', `${base}:release-please-config.json`));
    const allowed = new Set(['package.json', 'package-lock.json', '.release-please-manifest.json', 'CHANGELOG.md']);
    const lockWorkspaces = [];
    for (const entry of config.packages?.['.']?.['extra-files'] || []) {
        if (entry.type === 'json' && entry.jsonpath === '$.version') {
            allowed.add(entry.path);
        }
        // release-please also bumps workspace versions inside the lockfile: $.packages['apps/api'].version
        const ws = entry.type === 'json' && entry.path === 'package-lock.json' && /^\$\.packages\['([^']+)'\]\.version$/.exec(entry.jsonpath);
        if (ws) {
            lockWorkspaces.push(ws[1]);
        }
    }
    if (!git('merge-base', base, head).includes(base)) {
        return false;
    }
    for (const sha of git('rev-list', '--reverse', `${base}..${head}`).split('\n').filter(Boolean)) {
        const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
        if (!parents.length) {
            return false;
        }
        for (const path of git('diff', '--name-only', parents[0], sha).split('\n').filter(Boolean)) {
            if (!metadataOnly(blob(parents[0], path), blob(sha, path), path, allowed, lockWorkspaces)) {
                console.log(`Metadata gate blocked ${sha}: ${path}`);
                return false;
            }
        }
    }
    return true;
}
export async function orchestrate(mode, commandGh) {
    const token = requireToken();
    // Authenticate object fetches without storing credentials in the checkout.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    process.env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) {
        throw new Error('GITHUB_REPOSITORY is required');
    }
    const gh = commandGh || ((args) => execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token, GH_REPO: repo } }).trim());
    const api = (path) => JSON.parse(gh(['api', `repos/${repo}/${path}`]));
    const branch = (name) => api(`branches/${name}`).commit.sha;
    const ci = (sha, event) => latestCI(api(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=${event}&per_page=100`).workflow_runs, sha);
    const pulls = (base, head) => api(`pulls?state=open&base=${base}${head ? `&head=${repo.split('/')[0]}:${head}` : ''}&per_page=100`);
    const merge = (pr, sha, expectedBase) => {
        const fresh = api(`pulls/${pr.number}`);
        if (fresh.head.sha !== sha) {
            throw new Error('PR head changed before merge');
        }
        if (expectedBase && branch(pr.base.ref) !== expectedBase) {
            console.log(`Base changed for PR #${pr.number}; waiting for a new proof`);
            return;
        }
        if (fresh.mergeable_state === 'behind') {
            gh(['api', '--method', 'PUT', `repos/${repo}/pulls/${pr.number}/update-branch`, '-f', `expected_head_sha=${sha}`]);
            console.log(`Updated PR #${pr.number} base at head ${sha}; waiting for fresh CI`);
            return;
        }
        if (fresh.mergeable_state !== 'clean' || !ci(sha, 'pull_request')) {
            console.log(`Waiting for latest PR CI at ${sha}`);
            return;
        }
        if (expectedBase && branch(pr.base.ref) !== expectedBase) {
            console.log(`Base changed before merge of PR #${pr.number}; waiting for a new proof`);
            return;
        }
        console.log(`Performing ordinary merge PR #${pr.number} exact head ${sha}`);
        // 본문을 직접 준다 — 기본값(PR 제목)이 `fix(..): ..` 이면 release-please 가 원래 커밋과 함께 두 번 적는다.
        gh(['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', sha, '--body', `Merged head ${sha}`]);
    };
    const protection = (name) => {
        const p = api(`branches/${name}/protection`);
        const checks = p.required_status_checks;
        if (!checks?.strict || !(checks.contexts || []).some(c => c === 'CI Gate (Test → Build → Size → Lint)') && !(checks.checks || []).some(c => c.context === 'CI Gate (Test → Build → Size → Lint)')) {
            throw new Error(`${name} must require strict CI Gate (Test → Build → Size → Lint) before automation`);
        }
    };
    if (mode === 'feature') {
        const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        const run = event.workflow_run;
        if (run?.event !== 'pull_request' || run.conclusion !== 'success' || run.head_repository?.full_name !== repo) {
            return;
        }
        for (const summary of run.pull_requests || []) {
            const pr = api(`pulls/${summary.number}`);
            if (!eligiblePull(pr, run.head_sha, repo) || !ci(pr.head.sha, 'pull_request')) {
                continue;
            }
            const files = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr.number}/files?per_page=100`])).flat();
            // Deterministic structural review; this does not claim a semantic or LLM review.
            if (!files.length || files.some(f => f.status === 'removed' && f.filename === 'package.json' || f.filename.includes('\n') || f.changes > 20000)) {
                throw new Error(`Structural quality review blocked PR #${pr.number}; manual review required`);
            }
            console.log(`Structural quality review passed PR #${pr.number} head ${pr.head.sha}, ${files.length} files; CI run ${run.id}`);
            protection('dev');
            if (api(`pulls/${pr.number}`).head.sha !== run.head_sha) {
                throw new Error('PR head changed during review');
            }
            merge(pr, run.head_sha);
        }
    }
    else if (mode === 'promote') {
        const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        const run = event.workflow_run;
        if (run?.conclusion !== 'success' || !['push', 'pull_request'].includes(run.event) || run.head_branch !== 'dev') {
            return;
        }
        const sha = branch('dev');
        if (sha !== run.head_sha || !ci(sha, 'push')) {
            return;
        }
        protection('main');
        if (api('compare/main...dev').ahead_by === 0) {
            return;
        }
        let pr = pulls('main', 'dev')[0];
        if (!pr) {
            gh(['pr', 'create', '--base', 'main', '--head', 'dev', '--title', 'release: dev → main', '--body', `Promote dev ${sha}. Required current-base CI must pass before ordinary merge.`]);
            pr = pulls('main', 'dev')[0];
        }
        if (pr.head.sha !== sha || branch('dev') !== sha) {
            throw new Error('dev changed during promotion');
        }
        merge(pr, sha, branch('main'));
    }
    else if (mode === 'release') {
        const main = branch('main');
        // Fetch objects only. Candidate source is never checked out or executed.
        gh(['api', `repos/${repo}/git/matching-refs/omk/verified/`]);
        const refs = api('git/matching-refs/omk/verified/').filter(r => r.ref === `refs/omk/verified/${r.object.sha}`);
        if (!refs.length) {
            console.log(`No verified ancestor available for main ${main}; release waits`);
            return;
        }
        git('fetch', '--no-tags', 'origin', 'main', ...refs.map(r => `${r.ref}:${r.ref}`));
        const verified = refs.map(r => r.object.sha).find(sha => {
            try {
                return metadataRange(sha, main);
            }
            catch {
                return false;
            }
        });
        if (!verified) {
            console.log(`main ${main} has no verified ancestor with metadata-only intervening commits; release waits`);
            return;
        }
        for (const pr of pulls('main')) {
            if (!pr.labels.some(l => l.name === 'autorelease: pending') || pr.head.repo?.full_name !== repo || !pr.head.ref.startsWith('release-please--') || pr.draft) {
                continue;
            }
            git('fetch', '--no-tags', 'origin', pr.head.sha);
            if (!metadataRange(verified, pr.head.sha) || !ci(pr.head.sha, 'pull_request')) {
                continue;
            }
            protection('main');
            if (branch('main') !== main || api(`pulls/${pr.number}`).head.sha !== pr.head.sha) {
                throw new Error('Release base or head changed during verification');
            }
            console.log(`Release proof verified ${verified}, main ${main}, PR #${pr.number} head ${pr.head.sha}`);
            merge(pr, pr.head.sha, main);
        }
    }
    else {
        throw new Error(`Unknown mode ${mode}`);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv[2] === 'metadata-range') {
            if (!metadataRange(process.argv[3], process.argv[4])) {
                process.exitCode = 1;
            }
        }
        else {
            await orchestrate(process.argv[2]);
        }
    }
    catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
