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
const DEVICE_ID_PATH = path.join(CONFIG_DIR, 'device-id');

export interface CliConfig {
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

/** 호스트 고정 디바이스 id — 재실행에도 같은 디바이스로 식별된다(데스크톱 device-id 와 동일 패턴). */
export function deviceId(): string {
    try {
        const id = fs.readFileSync(DEVICE_ID_PATH, 'utf8').trim();
        if (id) return id;
    } catch { /* 최초 생성 */ }
    const id = crypto.randomUUID();
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    try { fs.writeFileSync(DEVICE_ID_PATH, id); } catch { /* noop */ }
    return id;
}
