/**
 * 브라우저 적합성 fixture(conformance/browser-*.json) TS 러너 — 같은 fixture 를 Rust 코어
 * (apps/openmake-code/crates/omk-bridge-core/tests/conformance_browser.rs)도 통과해야 한다. 형식은 conformance/BROWSER.md.
 * `browser-` 로 시작하는 파일은 이 러너 몫이고 코어 러너(conformance.test.ts)는 건너뛴다. Chrome 없이 돈다(CI 에서 전부 실행).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    BROWSER_FLOW_MAX_DEPTH, BROWSER_REPEAT_MAX, browserActionNeedsApproval, browserHostMatches, browserHostOf, checkBrowserAction,
    classifyBrowserAction, flattenBrowserActions, isBrowserHostAllowed, isNavigableBrowserUrl, parseBrowserSitePolicy, uploadFilesOf,
    validateBrowserFlow, type BrowserFlowCond, type BrowserSitePolicy, type BrowserUploadApproval,
} from '@openmake/config';
import * as constants from '../constants';
import * as defs from '../browser/local-browser-defs';
import { condExpression, runBrowserFlow } from '../browser/browser-flow';
import { downloadTaskOf, popupTaskOf } from '../browser/downloads';
import { browserPolicyBlockOf, uploadRejectedPolicyBlock, userControlPolicyBlock } from '../browser/policy-block';
import { resolveUploadFiles } from '../browser/upload-files';
import { DownloadRejectedError, placeDownload } from '../browser/download-place';
import type { Tab } from '../browser/local-browser-defs';
import {
    DIR, GROUPS, KNOWN_BROWSER_SUITES, applySetup, canonical, divergenceKeys, fill, fillDeep, inOrder, load, makeTmp, shape, shapeSetup, walk,
    type FsSetup,
} from './conformance-browser-support';

type Case<I = Record<string, unknown>, E = unknown> = { id: string; input: I; expect: E };
type Doc = Record<string, unknown>;
const SRC = path.join(__dirname, '..');
const arg = (i: Record<string, unknown>, k: string): unknown => (k in i ? i[k] : undefined);
const cases = <I = Record<string, unknown>, E = unknown>(doc: Doc, group: string): Case<I, E>[] => doc[group] as Case<I, E>[];

describe('browser fixture 목록·모양', () => {
    it('browser- 로 시작하는 파일은 이 러너가 아는 것뿐이고, 파일 이름과 suite 이름이 같다', () => {
        const files = fs.readdirSync(DIR).filter((f) => f.startsWith('browser-') && f.endsWith('.json')).sort();
        expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(KNOWN_BROWSER_SUITES);
    });

    it.each(KNOWN_BROWSER_SUITES)('%s — 최상위·묶음·사례 키, 빈 묶음·id 중복 없음, 알려진 차이 키 없음', (suite) => {
        const doc = load<Doc>(suite);
        const spec = GROUPS[suite];
        shape(doc, ['suite', 'version', ...spec.top, ...Object.keys(spec.groups)], [], suite);
        expect({ suite: doc.suite, version: doc.version }).toEqual({ suite, version: 1 });
        expect(divergenceKeys(doc, suite)).toEqual([]);
        for (const [group, [req, opt]] of Object.entries(spec.groups)) {
            const list = doc[group];
            expect({ at: `${suite}/${group}`, nonEmpty: Array.isArray(list) && list.length > 0 }).toEqual({ at: `${suite}/${group}`, nonEmpty: true });
            const ids = (list as Case[]).map((c) => c.id);
            expect({ at: `${suite}/${group}`, duplicated: ids.filter((id, i) => ids.indexOf(id) !== i) }).toEqual({ at: `${suite}/${group}`, duplicated: [] });
            for (const c of list as Case[]) {
                const at = `${suite}/${group}/${String(c.id)}`;
                shape(c, ['id', 'input', 'expect', ...(spec.caseKeys ?? [])], [], at);
                expect({ at, idString: typeof c.id === 'string' && c.id !== '' }).toEqual({ at, idString: true });
                shape(c.input, req, opt, `${at}/input`);
                if ((spec.caseKeys ?? []).includes('setup')) shapeSetup((c as Case & { setup: unknown }).setup, at);
            }
        }
        if (suite === 'browser-upload-files') shapeSetup(doc.baseSetup, `${suite}/baseSetup`);
    });
});

describe('browser-constants', () => {
    const doc = load<{ values: Doc; tables: Record<string, unknown>; messages: Record<string, string>; env: Doc; chrome: Doc }>('browser-constants');
    const consts = constants as unknown as Record<string, unknown>;

    it('values — BROWSER_* 와 흐름 상한(환경으로 바뀌는 값은 기본값)', () => {
        const own: Record<string, unknown> = { ...consts, BROWSER_FLOW_MAX_DEPTH, BROWSER_REPEAT_MAX };
        expect(Object.fromEntries(Object.keys(doc.values).map((k) => [k, own[k]]))).toEqual(doc.values);
        const exported = Object.keys(consts).filter((k) => k.startsWith('BROWSER_') && k !== 'BROWSER_INTERACTIVE_ROLES').sort();
        expect(exported).toEqual(Object.keys(doc.values).filter((k) => k in consts).sort());
    });

    it('tables — 역할·페이지 액션·분류표·차단 종류', () => {
        expect(constants.BROWSER_INTERACTIVE_ROLES).toEqual(doc.tables.interactiveRoles);
        expect([...defs.PAGE_ACTIONS].sort()).toEqual(doc.tables.pageActions);
        const cls = doc.tables.actionClass as Record<string, string>;
        expect(Object.fromEntries(Object.keys(cls).map((t) => [t, classifyBrowserAction({ type: t })]))).toEqual(cls);
        const src = fs.readFileSync(path.join(SRC, 'types.ts'), 'utf8');
        const union = /export type BrowserPolicyBlockKind = ([^;]+);/.exec(src)?.[1] ?? '';
        expect(union.split('|').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(doc.tables.policyBlockKinds);
        const flowSrc = fs.readFileSync(path.join(SRC, '..', '..', 'config', 'src', 'browser-site-policy.ts'), 'utf8');
        const table = /const ACTION_CLASS[^{]*\{([^}]*)\}/.exec(flowSrc)?.[1] ?? '';
        expect(table.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(':')[0].trim())).toEqual(Object.keys(cls));
    });

    it('messages — 오류 문구·페이지 조각', () => {
        const d = defs as unknown as Record<string, unknown>;
        expect(Object.fromEntries(Object.keys(doc.messages).map((k) => [k, d[k]]))).toEqual(doc.messages);
    });

    it('env — 환경 이름이 소스에 있고 기본값이 상수와 같다', () => {
        const src = fs.readFileSync(path.join(SRC, 'constants.ts'), 'utf8') + fs.readFileSync(path.join(SRC, 'browser', 'chrome.ts'), 'utf8');
        const own: Record<string, unknown> = {
            OMK_BRIDGE_CHROME: null, OMK_BRIDGE_BROWSER_HEADLESS: constants.BROWSER_HEADLESS, OMK_BRIDGE_BROWSER_TIMEOUT_MS: constants.BROWSER_ACTION_TIMEOUT_MS,
            OMK_BRIDGE_BROWSER_EXTRACT_READY_MS: constants.BROWSER_EXTRACT_READY_MS, OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS: constants.BROWSER_DOWNLOAD_WAIT_MS,
            OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES: constants.BROWSER_UPLOAD_MAX_FILE_BYTES,
        };
        expect(Object.fromEntries(Object.keys(doc.env).map((k) => [k, own[k]]))).toEqual(doc.env);
        for (const k of Object.keys(doc.env)) expect({ k, inSource: src.includes(`process.env.${k}`) }).toEqual({ k, inSource: true });
    });

    it('chrome — 후보 경로·실행 인자가 chrome.ts 에 이 순서로 있다', () => {
        const src = fs.readFileSync(path.join(SRC, 'browser', 'chrome.ts'), 'utf8');
        const c = doc.chrome as { darwin: string[]; win32Roots: string[]; win32Files: string[][]; other: string[]; args: string[]; headlessOnly: string[] };
        inOrder(src, c.darwin.map((p) => `'${p.replace('{{HOME}}/', '')}'`), 'darwin');
        inOrder(src, [c.win32Roots.map((r) => (/^[A-Z_]+$/.test(r) ? `process.env.${r}` : `process.env['${r}']`)).join(', ')], 'win32Roots');
        inOrder(src, c.win32Files.map((f) => `path.join(r, ${f.map((p) => `'${p}'`).join(', ')})`), 'win32Files');
        inOrder(src, c.other.map((p) => `'${p}'`), 'other');
        expect(constants.BROWSER_PROFILE_DIRECTORY).toBe('Default');
        const argText = (a: string): string => (c.headlessOnly.includes(a) ? `...(BROWSER_HEADLESS ? ['${a}'] : [])`
            : a.includes('{{PROFILE}}') ? `\`${a.replace('{{PROFILE}}', '${profileDir}')}\`` : a === '--profile-directory=Default' ? '`--profile-directory=${BROWSER_PROFILE_DIRECTORY}`' : `'${a}'`);
        inOrder(src, c.args.map(argText), 'args');
    });
});

describe('browser-site-policy', () => {
    const doc = load<Doc & { policies: Record<string, BrowserSitePolicy> }>('browser-site-policy');
    const pol = (n: unknown): BrowserSitePolicy => doc.policies[String(n)] ?? (() => { throw new Error(`모르는 정책 ${String(n)}`); })();
    type I = Record<string, unknown>;
    const run: Record<string, (i: I) => unknown> = {
        classify: (i) => classifyBrowserAction(arg(i, 'action')),
        hostOf: (i) => browserHostOf(arg(i, 'url')),
        navigable: (i) => isNavigableBrowserUrl(arg(i, 'url')),
        hostMatches: (i) => browserHostMatches(i.host as string, i.pattern as string),
        allowed: (i) => isBrowserHostAllowed(i.host as string | null, pol(i.policy)),
        needsApproval: (i) => browserActionNeedsApproval(arg(i, 'action'), i.host as string | null, pol(i.policy)),
        check: (i) => checkBrowserAction(arg(i, 'action'), i.host as string | null, pol(i.policy), i.approvedHosts as string[],
            ...('approvedUploads' in i ? [i.approvedUploads as BrowserUploadApproval[]] : [])),
        parsePolicy: (i) => parseBrowserSitePolicy(arg(i, 'raw')),
        uploadFilesOf: (i) => uploadFilesOf(arg(i, 'action')),
        policyBlock: (i) => (i.fn === 'of' ? browserPolicyBlockOf(arg(i, 'action'), i.host as string | null, pol(i.policy))
            : i.fn === 'userControl' ? userControlPolicyBlock(arg(i, 'action')) : uploadRejectedPolicyBlock(i.host as string | null)),
    };
    for (const group of Object.keys(GROUPS['browser-site-policy'].groups)) {
        it.each(cases(doc, group).map((c) => [c.id, c] as const))(`${group}/%s`, (_id, c) => {
            expect(run[group](c.input as I)).toEqual(c.expect);
        });
    }
});

describe('browser-flow', () => {
    const doc = load<Doc>('browser-flow');

    it.each(cases<{ actions?: unknown }, { error: string | null; flat?: unknown[] }>(doc, 'validate').map((c) => [c.id, c] as const))('validate/%s', (_id, c) => {
        const error = validateBrowserFlow(arg(c.input, 'actions'));
        expect(error === null ? { error, flat: flattenBrowserActions(arg(c.input, 'actions')) } : { error }).toEqual(c.expect);
    });

    it.each(cases<{ cond: BrowserFlowCond }, { expression: string }>(doc, 'cond').map((c) => [c.id, c] as const))('cond/%s', (_id, c) => {
        expect(validateBrowserFlow([{ type: 'if', cond: c.input.cond, then: [] }])).toBeNull();
        expect({ expression: condExpression(c.input.cond) }).toEqual(c.expect);
    });

    type Run = { actions: unknown[]; conds: Record<string, Array<boolean | 'throw' | { throw: string }>>; maxSimple: number };
    it.each(cases<Run, { results: string }>(doc, 'run').map((c) => [c.id, c] as const))('run/%s', async (_id, c) => {
        expect(validateBrowserFlow(c.input.actions)).toBeNull();
        const table = new Map(Object.entries(c.input.conds).map(([k, v]) => [canonical(JSON.parse(k)), v]));
        const used = new Map<string, number>();
        const evalCond = async (cond: BrowserFlowCond): Promise<boolean> => {
            const key = canonical(cond);
            const list = table.get(key);
            if (!list) throw new Error(`사례에 없는 조건: ${key}`);
            const n = used.get(key) ?? 0;
            used.set(key, n + 1);
            const v = list[Math.min(n, list.length - 1)];
            if (v === 'throw') throw new Error('조건 평가 실패');
            if (typeof v === 'object') throw new Error(v.throw);
            return v;
        };
        const runSimple = async (a: defs.Action, i: number): Promise<defs.BrowserActionResult> => (a.fail
            ? { i, type: a.type, ok: false, error: typeof a.fail === 'string' ? a.fail : '실패' } : { i, type: a.type, ok: true });
        // 글자 대조 — 결과 객체의 키 순서도 TS 리터럴 그대로여야 한다(D-76)
        expect(JSON.stringify(await runBrowserFlow(c.input.actions, { runSimple, evalCond }, c.input.maxSimple))).toBe(c.expect.results);
    });
});

describe('browser-defs', () => {
    const doc = load<Doc>('browser-defs');
    type I = Record<string, unknown>;
    const keyEvent = (combo: string): unknown => {
        try {
            const { text, common } = defs.keyEventOf(combo);
            return text === undefined ? { common } : { text, common };
        } catch (e) { return { error: (e as Error).message }; }
    };
    const run: Record<string, (i: I) => unknown> = {
        str: (i) => defs.str(arg(i, 'v')),
        screenshotName: (i) => defs.screenshotName(arg(i, 'path'), i.i as number | string),
        keyEventOf: (i) => keyEvent(i.combo as string),
        approvedUploads: (i) => defs.parseApprovedUploads(arg(i, 'raw')),
        clickPointJs: (i) => defs.clickPointJs(i.sel as string),
        fillPrepareJs: (i) => defs.fillPrepareJs(i.sel as string),
        downloadTaskOf: (i) => downloadTaskOf(i.tabs as Array<[string, Tab]>, i.popups as Array<[string, string]>,
            arg(i, 'sessionId') as string | undefined, i.frameId as string) ?? null,
        popupTaskOf: (i) => popupTaskOf(i.tabs as Array<[string, Tab]>, i.popups as Array<[string, string]>, i.openerId as string) ?? null,
        jsonString: (i) => JSON.stringify(i.s),
    };
    for (const group of Object.keys(GROUPS['browser-defs'].groups)) {
        it.each(cases(doc, group).map((c) => [c.id, c] as const))(`${group}/%s`, (_id, c) => {
            expect(run[group](c.input as I)).toEqual(c.expect);
        });
    }
});

describe('browser-upload-files', () => {
    const doc = load<{ baseSetup: FsSetup[]; cases: Array<Case<{ base: string; files: unknown }, { paths: string[] } | { error: string }> & { setup: FsSetup[] }> }>('browser-upload-files');
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applySetup(tmp, [...doc.baseSetup, ...c.setup]);
            const got = await resolveUploadFiles(fill(c.input.base, tmp), c.input.files).then((paths) => ({ paths }), (e: Error) => ({ error: e.message }));
            expect(got).toEqual(fillDeep(c.expect, tmp));
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

describe('browser-download-place', () => {
    type Expect = { savedAs: string } | { rejected: string } | { failed: string };
    const doc = load<{ cases: Array<Case<{ name: string; staged?: string }, Expect> & { setup: FsSetup[]; after: Record<string, unknown> }> }>('browser-download-place');
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            for (const d of ['root', 'staging', 'outside']) fs.mkdirSync(path.join(tmp, d));
            applySetup(tmp, c.setup);
            const staged = path.join(tmp, 'staging', 'guid-1');
            if (c.input.staged !== undefined) fs.writeFileSync(staged, c.input.staged);
            const root = path.join(tmp, 'root');
            // jest 는 테스트를 vm 영역에서 돌려 Node fs 오류가 그 영역의 `Error` 가 아니다 — placeDownload 의 `e instanceof Error ? … : String(e)`
            // 가 `Error: ` 를 붙인다. 운영 Node(헬퍼)에서는 붙지 않고 fixture 는 그 값이다(생성 스크립트가 jest 밖 Node 로 채웠다).
            const realm = (m: string): string => m.replace(/^Error: (E[A-Z]+: )/, '$1');
            const got = await placeDownload(root, { root, dirs: [] }, c.input.name, staged).then((savedAs) => ({ savedAs }),
                (e: Error) => (e instanceof DownloadRejectedError ? { rejected: realm(e.message) } : { failed: e.message }));
            expect(got).toEqual(fillDeep(c.expect, tmp));
            expect(walk(tmp)).toEqual(c.after);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});
