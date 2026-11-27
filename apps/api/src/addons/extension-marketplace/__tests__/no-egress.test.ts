/**
 * 판정은 LLM 을 부르지 않고 밖으로 아무것도 보내지 않는다(M1 원칙) — 소스 정적 검사.
 * 런타임 검사(fetch·http(s)·LLM 클라이언트 미호출)는 service.test.ts 가 한다.
 */
import fs from 'fs';
import path from 'path';

const DIR = path.resolve(__dirname, '..');
const sources = fs.readdirSync(DIR).filter(f => f.endsWith('.ts')).map(f => ({ f, src: fs.readFileSync(path.join(DIR, f), 'utf8') }));

const FORBIDDEN: Array<[string, RegExp]> = [
    ['LLM 클라이언트', /from ['"][./]*(?:llm|providers)\//],
    ['LLM 호출', /\bLLMClient\b|\bchat\(\s*\{|streamFromExternalProvider/],
    ['HTTP 클라이언트', /\bfetch\(|from ['"](?:node:)?https?['"]|require\(['"](?:node:)?https?['"]\)|\baxios\b|\bundici\b/],
    ['카탈로그 재동기화', /fetchCatalogSnapshot|git-ingest/],
];

describe('extension-marketplace — 외부 전송·LLM 0', () => {
    it('소스가 있다', () => {
        expect(sources.map(s => s.f)).toEqual(expect.arrayContaining(['verdict.ts', 'service.ts', 'routes.ts']));
    });

    it.each(FORBIDDEN)('%s 를 쓰지 않는다', (_label, pattern) => {
        expect(sources.filter(s => pattern.test(s.src)).map(s => s.f)).toEqual([]);
    });
});
