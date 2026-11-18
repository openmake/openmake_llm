/**
 * OpenMake Code CLI 설정 — ~/.openmake/config.json (0600) + device-id.
 * 서버 URL 과 API key(omk_live_*) 를 영속한다. 키는 평문 저장이므로 파일 권한으로 보호.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

export const CONFIG_DIR = path.join(os.homedir(), '.openmake');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

interface CliConfig {
    serverUrl: string;
    apiKey: string;
}

export function loadConfig(): CliConfig | null {
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<CliConfig>;
        if (typeof raw.serverUrl === 'string' && typeof raw.apiKey === 'string') {
            return { serverUrl: raw.serverUrl.replace(/\/+$/, ''), apiKey: raw.apiKey };
        }
    } catch { /* 미설정 */ }
    return null;
}

export function saveConfig(cfg: CliConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.chmodSync(CONFIG_PATH, 0o600);
}

/** 빈 id 파일 재읽기 — 옛 CLI 가 비운 뒤 쓰는 중일 수 있다. 횟수 × 간격 ≈ 기다리는 상한. */
const EMPTY_ID_RETRIES = 5;
const EMPTY_ID_RETRY_MS = 100;
/** 브라우저 주인 잠금·회수 권리 파일 이름(~/.openmake 아래). browser-owner.ts 가 쓴다. */
export const BROWSER_OWNER_LOCK = 'browser-owner.lock';
export const browserOwnerReclaimName = (token: string): string => `browser-owner.reclaim.${token}`;
export const browserOwnerTmpName = (token: string): string => `browser-owner.${token}.tmp`;

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readId(file: string): string | null {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
    }
}

/**
 * `dir/device-id` 의 PC id — 없으면 한 번만 원자적으로 만든다. 다 쓴 임시 파일을 `link` 로 올리므로
 * 여러 프로세스가 함께 만들어도 하나만 성공하고 반쯤 쓰인 파일이 보이지 않는다. 자기가 만든 값이 아니라
 * 파일에 남은 값을 돌려준다. 만들지도 읽지도 못하면 오류 — 저장되지 않은 임시 id 로 연결하지 않는다.
 * `hooks` 는 테스트 주입용이다.
 */
export function hostIdIn(dir: string, hooks: { beforeLink?: () => void } = {}): string {
    const file = path.join(dir, 'device-id');
    const fail = (cause?: unknown): Error => new Error(`기기 id 파일을 만들지 못했습니다 (${file})${cause ? `: ${(cause as Error).message}` : ''}`);
    let id: string | null;
    try {
        id = readId(file);
        if (id === null) {
            fs.mkdirSync(dir, { recursive: true });
            const tmp = path.join(dir, `device-id.${crypto.randomBytes(8).toString('hex')}.tmp`);
            try {
                fs.writeFileSync(tmp, crypto.randomUUID());
                hooks.beforeLink?.();
                try { fs.linkSync(tmp, file); } catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
                }
            } finally {
                fs.rmSync(tmp, { force: true });
            }
            id = readId(file);
        }
        for (let i = 0; i < EMPTY_ID_RETRIES && !id; i++) {
            sleepSync(EMPTY_ID_RETRY_MS);
            id = readId(file);
        }
    } catch (e) {
        throw fail(e);
    }
    if (!id) throw fail();
    return id;
}

let cachedHostId: string | null = null;

/** PC 고정 id(~/.openmake/device-id) — 서버에 hostId 로 보내고 폴더별 deviceId 의 앞부분이 된다(Companion 과 같은 규칙). */
export function hostId(): string {
    cachedHostId ??= hostIdIn(CONFIG_DIR);
    return cachedHostId;
}

/** 폴더별 deviceId — `<hostId>-r-<sha256(폴더 realpath) 앞 12자>`. 같은 폴더는 심링크로 와도 같은 id. */
export function deviceIdFor(folder: string): string {
    let real: string;
    try { real = fs.realpathSync(folder); } catch { throw new Error(`폴더가 존재하지 않습니다: ${folder}`); }
    return `${hostId()}-r-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 12)}`;
}
