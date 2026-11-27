/**
 * 레지스트리 동기화의 외부 요청 경계 — 소스 정적 검사.
 *  - 밖으로 나가는 곳은 registry-client.ts 하나, 기본 요청 함수는 Base SSRF 가드 포트(runtime-ports/outbound-http)
 *  - node http(s)·axios·undici 직접 사용 없음, LLM 호출 없음
 *  - 판정(verdict·service)은 레지스트리 코드를 import 하지 않는다(판정의 "외부 전송 0" 유지)
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const REG = path.join(ROOT, 'registry');
const regSources = fs.readdirSync(REG).filter(f => f.endsWith('.ts')).map(f => ({ f, src: fs.readFileSync(path.join(REG, f), 'utf8') }));

describe('registry 외부 요청 경계', () => {
    it('fetch 를 부르는 파일은 registry-client.ts 와 그것을 주입받는 sync.ts 뿐', () => {
        const callers = regSources.filter(s => /\bfetch\w*\(/.test(s.src)).map(s => s.f).sort();
        expect(callers).toEqual(['registry-client.ts', 'sync.ts']);
        const client = regSources.find(s => s.f === 'registry-client.ts')!.src;
        expect(client).toMatch(/runtime-ports\/outbound-http/);
        expect(client).toMatch(/safeFetch\(/);
        // 전역 fetch 직접 호출 없음(주입받은 fetchImpl 또는 safeFetch 만)
        expect(client.replace(/safeFetch\(|fetchImpl\(|defaultRegistryFetch\(/g, '')).not.toMatch(/(?<![\w.])fetch\(/);
    });

    it('다른 HTTP 클라이언트·LLM 을 쓰지 않는다', () => {
        const bad = regSources.filter(s => /from ['"](?:node:)?https?['"]|\baxios\b|\bundici\b|from ['"][./]*(?:llm|providers)\/|\bLLMClient\b/.test(s.src));
        expect(bad.map(s => s.f)).toEqual([]);
    });

    it('판정 모듈은 레지스트리 코드를 import 하지 않는다', () => {
        for (const f of ['verdict.ts', 'service.ts', 'verdict-repository.ts', 'constants.ts']) {
            expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).not.toMatch(/['"]\.\/registry\//);
        }
    });
});
