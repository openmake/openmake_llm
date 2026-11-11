import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/desktop-native.yml', import.meta.url), 'utf8');
// release 는 마지막 job 이다 — 그 아래 전부가 이 job 의 정의.
const release = workflow.slice(workflow.search(/^ {2}release:$/m));

test('release job exists and runs only for main pushes after the companion build', () => {
    assert.ok(release.startsWith('  release:'), 'release job present');
    const condition = release.match(/^ {4}if: (.+)$/m)?.[1] ?? '';
    assert.ok(condition.includes("github.event_name == 'push'"), condition);
    assert.ok(condition.includes("github.ref == 'refs/heads/main'"), condition);
    assert.match(release, /^ {4}needs: companion$/m);
});

test('only the release job gets write permissions; the workflow default stays read-only', () => {
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
    assert.match(release, /^ {4}permissions:\n {6}contents: write\n {6}id-token: write\n {6}attestations: write\n/m);
    assert.equal(workflow.match(/contents: write/g)?.length, 1);
});

test('the gate compares the pushed range on apps/desktop-native/VERSION and skips an existing release', () => {
    assert.match(release, /git diff --quiet "\$BEFORE" "\$GITHUB_SHA" -- apps\/desktop-native\/VERSION/);
    assert.match(release, /git cat-file -e "\$BEFORE\^\{commit\}"/);
    assert.match(release, /gh release view "desktop-native-v\$VERSION"/);
    assert.match(release, /BEFORE: \$\{\{ github\.event\.before \}\}/);
});

test('a release is created once as a non-latest pre-release and assets are never overwritten', () => {
    assert.match(release, /gh release create "desktop-native-v\$VERSION"/);
    assert.ok(release.includes('--prerelease'));
    assert.ok(release.includes('--latest=false'));
    assert.ok(release.includes('--target "$GITHUB_SHA"'));
    assert.doesNotMatch(workflow, /--clobber|gh release upload/);
});

test('release steps pin actions to commit SHAs and pass expressions through env/with only', () => {
    const uses = [...release.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 4, uses.join(' '));
    for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, ref);
    for (const line of release.split('\n').filter((l) => l.includes('${{'))) {
        assert.match(line, /^\s+(if|[A-Za-z_-]+): .*\$\{\{/, `expression outside a key: ${line}`);
        assert.doesNotMatch(line, /^\s+run: /, `expression inside run: ${line}`);
    }
});

test('the gate fails on a leftover draft release instead of skipping it, and never deletes it', () => {
    const gate = release.slice(release.indexOf('id: gate'), release.indexOf('- name: Download dmg'));
    assert.match(gate, /gh release view "desktop-native-v\$VERSION" --json isDraft --jq \.isDraft/);
    const draft = gate.match(/if \[\[ "\$DRAFT" == "true" \]\]; then\n([\s\S]*?)\n\s*fi\n/)?.[1] ?? '';
    assert.match(draft, /::error::.*초안/, draft);
    assert.match(draft, /exit 1/, draft);
    assert.ok(gate.indexOf('"$DRAFT" == "true"') < gate.indexOf('이미 있음'), 'draft check runs before the skip');
    assert.doesNotMatch(workflow, /gh release delete|gh release edit/);
});

test('every step after the gate runs only when the gate says publish', () => {
    const steps = new Map(release.split(/^ {6}- name: /m).slice(1).map((s) => [s.slice(0, s.indexOf('\n')), s]));
    for (const name of ['Download dmg', 'Release manifest', 'Attest build provenance', 'Create pre-release']) {
        assert.ok(steps.has(name), `step ${name} present`);
        assert.match(steps.get(name), /^ {8}if: steps\.gate\.outputs\.publish == 'true'$/m, name);
    }
});
