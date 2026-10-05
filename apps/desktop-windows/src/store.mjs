// 설정·자격증명 저장 — Electron 에 의존하지 않게 암호화 함수를 주입받는다(테스트 가능).
// API key 는 OS 자격증명 보호(Windows DPAPI, safeStorage)로 암호화한 것만 디스크에 쓴다. 암호화를 쓸 수 없으면 저장하지 않는다.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const DEFAULT_SERVER = 'https://chat.openmake.cc';

export class Store {
  /** crypt: { isAvailable(): boolean, encrypt(text): Buffer, decrypt(buf): string } */
  constructor(dir, crypt) {
    this.dir = dir;
    this.crypt = crypt;
    fs.mkdirSync(dir, { recursive: true });
  }

  #file(name) { return path.join(this.dir, name); }

  loadSettings() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.#file('settings.json'), 'utf8')); } catch { /* 처음 실행 */ }
    return {
      server: typeof raw.server === 'string' && /^https?:\/\//.test(raw.server) ? raw.server.replace(/\/+$/, '') : DEFAULT_SERVER,
      browserEnabled: raw.browserEnabled === true,
      folders: Array.isArray(raw.folders) ? raw.folders.filter((f) => typeof f === 'string') : [],
    };
  }

  saveSettings(patch) {
    const next = { ...this.loadSettings(), ...patch };
    fs.writeFileSync(this.#file('settings.json'), JSON.stringify(next, null, 2));
    return next;
  }

  /** 저장했으면 true. 암호화를 쓸 수 없으면 저장하지 않고 false(평문으로 남기지 않는다). 빈 값은 삭제. */
  saveApiKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) { fs.rmSync(this.#file('api-key.bin'), { force: true }); return true; }
    if (!this.crypt.isAvailable()) return false;
    fs.writeFileSync(this.#file('api-key.bin'), this.crypt.encrypt(trimmed));
    return true;
  }

  loadApiKey() {
    try { return this.crypt.isAvailable() ? this.crypt.decrypt(fs.readFileSync(this.#file('api-key.bin'))) : ''; } catch { return ''; }
  }

  /** PC 식별자 — 한 번 만들어 계속 쓴다. 폴더별 연결이 같은 PC 임을 서버에 알리는 값(hostId). */
  hostId() {
    const f = this.#file('device-id');
    try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9-]{36}$/.test(v)) return v; } catch { /* 없음 */ }
    const id = crypto.randomUUID();
    fs.writeFileSync(f, id);
    return id;
  }

  /** 폴더별 기기 ID — 다시 연결해도 같은 값(서버가 같은 세션으로 대체한다). 36+3+12=51자, 서버 상한 64. */
  deviceIdFor(root) {
    return `${this.hostId()}-r-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
  }
}
