/**
 * conformance-browser.test.ts 의 도우미 — 테스트 파일이 아니다(jest testMatch 밖, 패키지 빌드에서도 빠진다).
 * 브라우저 suite(`browser-*.json`)의 모양 표와 파일 suite 의 setup·after. 형식은 conformance/BROWSER.md.
 * Rust 러너(apps/openmake-code/crates/omk-bridge-core/tests/conformance_browser.rs)가 같은 표를 따로 적는다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const DIR = path.join(__dirname, '..', '..', 'conformance');
/** 이 러너 몫 — `browser-` 로 시작하는 파일은 정확히 이것뿐이어야 한다(`browser-run` 은 conformance-browser-run.test.ts 가 돌린다). */
export const KNOWN_BROWSER_SUITES = ['browser-constants', 'browser-defs', 'browser-download-place', 'browser-flow', 'browser-run', 'browser-site-policy', 'browser-upload-files'];

/** 묶음 이름 → 입력 키 [필수, 선택]. 사례 키는 `id`·`input`·`expect`(파일 suite 는 `setup`·`after` 를 더한다). */
type Inputs = Record<string, [string[], string[]]>;
export const GROUPS: Record<string, { top: string[]; groups: Inputs; caseKeys?: string[] }> = {
    'browser-site-policy': {
        top: ['policies'],
        groups: {
            classify: [[], ['action']],
            hostOf: [[], ['url']],
            navigable: [[], ['url']],
            hostMatches: [['host', 'pattern'], []],
            allowed: [['host', 'policy'], []],
            needsApproval: [['host', 'policy'], ['action']],
            check: [['host', 'policy', 'approvedHosts'], ['action', 'approvedUploads']],
            parsePolicy: [[], ['raw']],
            uploadFilesOf: [[], ['action']],
            policyBlock: [['fn'], ['action', 'host', 'policy']],
        },
    },
    'browser-flow': {
        top: [],
        groups: { validate: [[], ['actions']], cond: [['cond'], []], run: [['actions', 'conds', 'maxSimple'], []] },
    },
    'browser-defs': {
        top: [],
        groups: {
            str: [[], ['v']],
            screenshotName: [['i'], ['path']],
            keyEventOf: [['combo'], []],
            approvedUploads: [[], ['raw']],
            clickPointJs: [['sel'], []],
            fillPrepareJs: [['sel'], []],
            downloadTaskOf: [['tabs', 'running', 'frameId'], ['sessionId']],
            jsonString: [['s'], []],
        },
    },
    'browser-upload-files': { top: ['baseSetup'], groups: { cases: [['base', 'files'], []] }, caseKeys: ['setup'] },
    'browser-download-place': { top: [], groups: { cases: [['name'], ['staged']] }, caseKeys: ['setup', 'after'] },
    'browser-constants': { top: ['values', 'tables', 'messages', 'env', 'chrome'], groups: {} },
    'browser-run': { top: ['defaults'], groups: { cases: [['spec', 'opts', 'cdp'], ['sentDefaults', 'userControl']] }, caseKeys: ['setup'] },
};

export function load<T>(suite: string): T {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8')) as T;
}

/** required 는 모두 있어야 하고, 그 밖의 키는 optional 만 쓸 수 있다. */
export function shape(o: unknown, required: string[], optional: string[], at: string): void {
    const keys = o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null;
    expect({ at, object: keys !== null }).toEqual({ at, object: true });
    expect({ at, missing: required.filter((k) => !keys!.includes(k)), unknown: keys!.filter((k) => !required.includes(k) && !optional.includes(k)) })
        .toEqual({ at, missing: [], unknown: [] });
}

/** 문서 전체에서 알려진 차이 키(divergence·rustExpect)를 찾는다 — 브라우저 suite 는 쓰지 않는다(D-81). */
export function divergenceKeys(v: unknown, at: string, out: string[] = []): string[] {
    if (Array.isArray(v)) v.forEach((x, i) => divergenceKeys(x, `${at}/${i}`, out));
    else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
            if (k === 'divergence' || k === 'rustExpect') out.push(`${at}/${k}`);
            divergenceKeys(x, `${at}/${k}`, out);
        }
    }
    return out;
}

/** 키 순서를 무시한 값 대조용 글자 — 조건 JSON 을 값으로 찾는다. */
export function canonical(v: unknown): string {
    const sort = (x: unknown): unknown => (Array.isArray(x) ? x.map(sort)
        : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x);
    return JSON.stringify(sort(v));
}

export function makeTmp(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-browser-')));
}
export const fill = (s: string, tmp: string): string => s.split('{{TMP}}').join(tmp);
export function fillDeep<T>(v: T, tmp: string): T {
    if (typeof v === 'string') return fill(v, tmp) as T;
    if (Array.isArray(v)) return v.map((x) => fillDeep(x, tmp)) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, tmp)])) as T;
    return v;
}

export type FsSetup = { dir: string } | { file: string; content: string } | { file: string; size: number } | { symlink: string; target: string }
    | { hardlink: string; target: string } | { series: string; from: number; to: number; content: string };
export const SETUP_SHAPES: Array<[string, string[]]> = [['dir', ['dir']], ['symlink', ['symlink', 'target']], ['hardlink', ['hardlink', 'target']], ['series', ['series', 'from', 'to', 'content']]];

export function shapeSetup(setup: unknown, at: string): void {
    expect({ at, setupArray: Array.isArray(setup) }).toEqual({ at, setupArray: true });
    for (const s of setup as Record<string, unknown>[]) {
        const known = SETUP_SHAPES.find(([k]) => s && typeof s === 'object' && k in s);
        if (known) shape(s, known[1], [], `${at}/setup`);
        else if (s && typeof s === 'object' && 'size' in s) shape(s, ['file', 'size'], [], `${at}/setup`);
        else shape(s, ['file', 'content'], [], `${at}/setup`);
    }
}

/** `{{TMP}}` 기준으로 만든다, 적힌 순서대로. size 는 성긴 파일(0 바이트로 채운 길이). */
export function applySetup(tmp: string, setup: FsSetup[]): void {
    for (const s of setup) {
        if ('dir' in s) fs.mkdirSync(path.join(tmp, s.dir), { recursive: true });
        else if ('symlink' in s) fs.symlinkSync(fill(s.target, tmp), path.join(tmp, s.symlink));
        else if ('hardlink' in s) fs.linkSync(fill(s.target, tmp), path.join(tmp, s.hardlink));
        else if ('series' in s) for (let n = s.from; n <= s.to; n++) fs.writeFileSync(path.join(tmp, s.series.replace('{n}', String(n))), s.content);
        else {
            fs.mkdirSync(path.dirname(path.join(tmp, s.file)), { recursive: true });
            fs.writeFileSync(path.join(tmp, s.file), 'size' in s ? '' : s.content);
            if ('size' in s) fs.truncateSync(path.join(tmp, s.file), s.size);
        }
    }
}

/** 임시 폴더 전체 — 경로(`{{TMP}}` 기준) → 글(UTF-8) · `{symlink: 대상}` · `{dir: true}`. 이름 순. */
export function walk(tmp: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const go = (rel: string): void => {
        for (const name of fs.readdirSync(path.join(tmp, rel)).sort()) {
            const r = rel ? `${rel}/${name}` : name;
            const p = path.join(tmp, r);
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) out[r] = { symlink: fs.readlinkSync(p).split(tmp).join('{{TMP}}') };
            else if (st.isDirectory()) { out[r] = { dir: true }; go(r); }
            else out[r] = fs.readFileSync(p, 'utf8');
        }
    };
    go('');
    return out;
}

/** chrome.ts 의 글자 — 후보 경로·실행 인자가 이 순서로 소스에 있는지(TS 는 그 함수를 내보내지 않는다, 계획 D-79). */
export function inOrder(src: string, fragments: string[], at: string): void {
    let last = -1;
    for (const f of fragments) {
        const i = src.indexOf(f, last + 1);
        expect({ at, fragment: f, found: i > last }).toEqual({ at, fragment: f, found: true });
        last = i;
    }
}
