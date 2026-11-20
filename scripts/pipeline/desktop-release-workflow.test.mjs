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

test('push and pull_request path filters both cover the Rust helper, the app and the bridge core', () => {
    for (const event of ['push', 'pull_request']) {
        const block = workflow.match(new RegExp(`^ {2}${event}:\\n([\\s\\S]*?)(?=^ {2}\\S|^\\S)`, 'm'))?.[1] ?? '';
        for (const path of ['apps/openmake-code/**', 'apps/desktop-native/**', 'packages/local-bridge-core/**']) {
            assert.ok(block.includes(`- '${path}'`), `${event} filter has ${path}`);
        }
    }
});

test('the companion job installs the Rust toolchain before building omk-helper and runs the harness on that release binary', () => {
    const companion = workflow.slice(workflow.search(/^ {2}companion:$/m), workflow.search(/^ {2}release:$/m));
    // 줄 머리 기준 — 주석으로 죽인 줄(`# ...`)은 찾지 못한다.
    const at = (re) => companion.search(re);
    const toolchain = at(/^ +rustup toolchain install$/m);
    const cargoBuild = at(/^ +\(cd apps\/openmake-code && cargo build --release --locked -p omk-helper\)$/m);
    const harness = at(/^ +node apps\/desktop-native\/helper\/harness\.cjs --helper apps\/openmake-code\/target\/release\/omk-helper$/m);
    const buildSh = at(/^ +run: bash apps\/desktop-native\/build\.sh$/m);
    assert.ok(toolchain > 0, 'rustup toolchain install present');
    assert.ok(cargoBuild > toolchain, 'toolchain before cargo build');
    assert.ok(harness > cargoBuild, 'cargo build before harness');
    assert.ok(buildSh > harness, 'harness before build.sh');
});

// plan-pr2.4 D-150: 2.5 뒤 옛 정체성 재발행은 고정 이름 가지 release/desktop-bridge 에서 빌드한다.
test('the release job condition allows exactly main and release/desktop-bridge pushes', () => {
    const condition = release.match(/^ {4}if: (.+)$/m)?.[1] ?? '';
    const refs = [...condition.matchAll(/github\.ref == '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(refs, ['refs/heads/main', 'refs/heads/release/desktop-bridge'], condition);
    assert.doesNotMatch(condition, /startsWith|contains|!=/, condition);
    assert.match(condition, /^github\.event_name == 'push' && \(github\.ref == '[^']+' \|\| github\.ref == '[^']+'\)$/, condition);
    const push = workflow.match(/^ {2}push:\n {4}branches: \[(.+)\]$/m)?.[1] ?? '';
    assert.deepEqual(push.split(',').map((s) => s.trim()), ['main', 'dev', 'release/desktop-bridge']);
    const pr = workflow.match(/^ {2}pull_request:\n {4}branches: \[(.+)\]$/m)?.[1] ?? '';
    assert.deepEqual(pr.split(',').map((s) => s.trim()), ['main', 'dev']);
});

// plan-pr2.5 D-155·D-164: 새 앱(OpenMake Code)은 후속 교체 스크립트를 갖지 않는다 — 그 셸 테스트 단계(Gate 2-S)도 없다.
test('the companion job runs the Swift tests before the dmg and has no successor replace script step', () => {
    const companion = workflow.slice(workflow.search(/^ {2}companion:$/m), workflow.search(/^ {2}release:$/m));
    const swiftTest = companion.search(/^ +run: swift test --package-path apps\/desktop-native\/OpenMakeCompanion$/m);
    const buildSh = companion.search(/^ +run: bash apps\/desktop-native\/build\.sh$/m);
    assert.ok(swiftTest > 0, 'swift test present');
    assert.ok(buildSh > swiftTest, 'swift test before build.sh');
    assert.doesNotMatch(workflow, /successor-replace|Gate 2-S/);
});

test('the dmg artifact is OpenMake-Code-dmg on both upload and download, with the OpenMake-Code glob', () => {
    const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@\S+.*\n {8}with:\n {10}name: (\S+)\n {10}path: (\S+)/g)];
    const downloads = [...workflow.matchAll(/uses: actions\/download-artifact@\S+.*\n {8}with:\n {10}name: (\S+)/g)];
    assert.equal(uploads.length, 1);
    assert.equal(downloads.length, 1);
    assert.equal(uploads[0][1], 'OpenMake-Code-dmg');
    assert.equal(downloads[0][1], 'OpenMake-Code-dmg');
    assert.equal(uploads[0][2], 'apps/desktop-native/dist/OpenMake-Code-*.dmg');
    assert.doesNotMatch(workflow, /OpenMake-Companion-/);
});
