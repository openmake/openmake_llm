/**
 * 실제 web-push 패키지 런타임 회귀 — jest 안의 web-push 는 moduleNameMapper shim 이라 실제 패키지를 실행하지 않는다.
 * 그래서 별도 Node 프로세스에서 PushService 와 같은 CJS 변환(`import * as webPush` → tsc esModuleInterop)으로
 * 실제 패키지를 불러와 키 생성 → VAPID 설정 → 서명·암호화된 요청 생성까지 확인한다(네트워크 없음).
 * (#1825 web-push 3.6.7 → 4.0.0, ESM 전용)
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';

const apiRoot = path.resolve(__dirname, '../../..');

/** 소스의 실제 `from 'web-push'` import 줄을 api tsconfig 와 같은 옵션으로 변환한 CJS 코드 — import 모양이 바뀌면 이 테스트가 그 모양으로 돈다 */
function compiledImportOf(source: string): string {
    const text = readFileSync(path.join(apiRoot, source), 'utf8');
    const line = text.split('\n').find((l) => /^import\s.+\sfrom\s+['"]web-push['"];?\s*$/.test(l));
    if (!line) throw new Error(`${source}: web-push import 줄이 없다`);
    const binding = /^import\s+(?:\*\s+as\s+)?(\w+)\s+from/.exec(line)?.[1];
    if (!binding) throw new Error(`${source}: 지원하지 않는 import 모양 — 이 테스트를 맞춰야 한다: ${line}`);
    return ts.transpileModule(`${line}\nexport const mod = ${binding};\n`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
}

const childScript = (compiledImport: string): string => `
const crypto = require('crypto');
const m = { exports: {} };
new Function('require', 'module', 'exports', ${JSON.stringify(compiledImport)})(require, m, m.exports);
const webPush = m.exports.mod;
const keys = webPush.generateVAPIDKeys();
webPush.setVapidDetails('mailto:admin@example.com', keys.publicKey, keys.privateKey);
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const sub = {
  endpoint: 'https://push.example.com/send/abc',
  keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
};
const payload = JSON.stringify({ title: 't', body: 'b' });
const d = webPush.generateRequestDetails(sub, payload, { TTL: 60 });
process.stdout.write(JSON.stringify({
  fns: ['sendNotification', 'setVapidDetails', 'generateVAPIDKeys'].map((k) => typeof webPush[k]),
  method: d.method,
  endpoint: d.endpoint,
  headers: d.headers,
  bodyLength: d.body ? d.body.length : 0,
  payloadLength: Buffer.byteLength(payload),
}));
`;

describe('web-push 실제 패키지 런타임 (별도 Node 프로세스)', () => {
    it.each(['src/services/PushService.ts', 'src/utils/vapid.ts'])('%s 의 import 를 CJS 변환해 키 생성·VAPID 서명·aes128gcm 암호화 요청을 만든다', (source) => {
        const out = execFileSync(process.execPath, ['-e', childScript(compiledImportOf(source))], { cwd: apiRoot, encoding: 'utf8', timeout: 30_000 });
        const r = JSON.parse(out);
        expect(r.fns).toEqual(['function', 'function', 'function']);
        expect(r.method).toBe('POST');
        expect(r.endpoint).toBe('https://push.example.com/send/abc');
        expect(r.headers.TTL).toBe(60);
        expect(r.headers['Content-Encoding']).toBe('aes128gcm');
        expect(r.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
        expect(r.bodyLength).toBeGreaterThan(r.payloadLength);
    });
});
