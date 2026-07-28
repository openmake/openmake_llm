/**
 * artifact-parser unit tests — Phase 3 보완 G.1 (2026-05-26).
 *
 * 검증 영역:
 *   1. ArtifactStreamParser (incremental): 청크 잘림, 한국어 attribute, partial 태그
 *   2. extractAndStripArtifacts (post-hoc): 명시 태그 + fence fallback + placeholder
 */
import {
    ArtifactStreamParser,
    extractAndStripArtifacts,
    findArtifactPlaceholderIds,
    stripArtifactPlaceholders,
    type ArtifactInfo,
    type ArtifactStreamCallbacks,
} from '../artifact-parser';

function makeCollector(): { callbacks: ArtifactStreamCallbacks; events: string[] } {
    const events: string[] = [];
    const callbacks: ArtifactStreamCallbacks = {
        onContent: (d) => events.push(`C:${d}`),
        onArtifactStart: (info: ArtifactInfo) =>
            events.push(`START:${info.id}|${info.kind}|${info.title}|${info.lang ?? ''}`),
        onArtifactChunk: (id, d) => events.push(`CHUNK:${id}|${d}`),
        onArtifactEnd: (id) => events.push(`END:${id}`),
    };
    return { callbacks, events };
}

describe('ArtifactStreamParser (incremental)', () => {
    it('일반 텍스트는 onContent 로만 흘러간다', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('안녕하세요 ');
        parser.feed('반갑습니다');
        parser.flush();
        expect(events).toEqual(['C:안녕하세요 ', 'C:반갑습니다']);
    });

    it('단일 청크로 완전한 artifact 분리', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('prefix <artifact id="x" kind="code" title="T" lang="py">body</artifact> suffix');
        parser.flush();
        expect(events).toEqual([
            'C:prefix ',
            'START:x|code|T|py',
            'CHUNK:x|body',
            'END:x',
            'C: suffix',
        ]);
    });

    it('시작 태그가 청크 경계에서 잘려도 처리', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('foo <art');
        parser.feed('ifact id="a" kind="code" title="A">in');
        parser.feed('side</artifact> bar');
        parser.flush();
        expect(events).toContain('START:a|code|A|');
        expect(events).toContain('END:a');
        // 본문 'inside' 는 1개 또는 2개의 CHUNK 로 도착 가능 — 합쳐서 'inside' 면 OK
        const chunks = events.filter(e => e.startsWith('CHUNK:a|')).map(e => e.slice('CHUNK:a|'.length));
        expect(chunks.join('')).toBe('inside');
        // outside content 도 합쳐서 'foo  bar' 형태
        const content = events.filter(e => e.startsWith('C:')).map(e => e.slice('C:'.length));
        expect(content.join('')).toContain('foo ');
        expect(content.join('')).toContain(' bar');
    });

    it('닫는 태그가 청크 경계에서 잘려도 처리', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('<artifact id="b" kind="code" title="B">aaa</art');
        parser.feed('ifact>tail');
        parser.flush();
        const chunks = events.filter(e => e.startsWith('CHUNK:b|')).map(e => e.slice('CHUNK:b|'.length));
        expect(chunks.join('')).toBe('aaa');
        expect(events).toContain('END:b');
        expect(events).toContain('C:tail');
    });

    it('한국어 title attribute 정상 파싱', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('<artifact id="ko" kind="code" title="큐 구현" lang="python">code</artifact>');
        parser.flush();
        expect(events).toContain('START:ko|code|큐 구현|python');
    });

    it('id/kind 없는 lazy attribute (싱글 quote, unquoted)', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed(`<artifact id='lazy' kind=code title="L">x</artifact>`);
        parser.flush();
        expect(events).toContain('START:lazy|code|L|');
    });

    it('flush 시 닫는 태그 없이 끝난 partial artifact 도 emit', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('<artifact id="p" kind="code" title="P">incomplete...');
        parser.flush();
        expect(events).toContain('START:p|code|P|');
        expect(events.find(e => e.startsWith('CHUNK:p|'))).toBeDefined();
        expect(events).toContain('END:p');
    });

    it('outside 의 partial 시작 태그 prefix 가 안전하게 buffer 됨', () => {
        const { callbacks, events } = makeCollector();
        const parser = new ArtifactStreamParser(callbacks);
        parser.feed('hello <a');
        // 이 시점에 outside content 는 'hello ' 만 emit, '<a' 는 buffer
        expect(events).toEqual(['C:hello ']);
        parser.feed('rtifact id="q" kind="code" title="Q">body</artifact>');
        parser.flush();
        expect(events).toContain('START:q|code|Q|');
    });
});

describe('extractAndStripArtifacts (post-hoc)', () => {
    it('명시적 <artifact> 블록을 placeholder 로 치환 + content 추출', () => {
        const raw = 'before\n<artifact id="md1" kind="markdown" title="문서">## 제목\nbody</artifact>\nafter';
        const { cleanedContent, artifacts } = extractAndStripArtifacts(raw);
        expect(cleanedContent).toBe('before\n[[artifact:md1]]\nafter');
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].id).toBe('md1');
        expect(artifacts[0].kind).toBe('markdown');
        expect(artifacts[0].title).toBe('문서');
        expect(artifacts[0].content).toBe('## 제목\nbody');
    });

    it('Fallback: ≥15줄 code fence 도 자동 artifact 변환', () => {
        const longBody = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
        const raw = '응답:\n```python\n' + longBody + '\n```\n끝';
        const { cleanedContent, artifacts } = extractAndStripArtifacts(raw);
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].id).toMatch(/^auto-python-/);
        expect(artifacts[0].kind).toBe('code');
        expect(artifacts[0].lang).toBe('python');
        expect(artifacts[0].content).toContain('line 1');
        expect(artifacts[0].content).toContain('line 20');
        // cleanedContent 에는 placeholder 만 남음
        expect(cleanedContent).toContain('[[artifact:auto-python-');
        expect(cleanedContent).not.toContain('```python');
    });

    it('Fallback: 짧은 (≤14줄) fence 는 inline 유지', () => {
        const shortBody = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
        const raw = '```js\n' + shortBody + '\n```';
        const { cleanedContent, artifacts } = extractAndStripArtifacts(raw);
        expect(artifacts).toHaveLength(0);
        expect(cleanedContent).toBe(raw);
    });

    it('명시 태그 + fence fallback 혼합', () => {
        const longBody = Array.from({ length: 16 }, (_, i) => `c${i}`).join('\n');
        const raw =
            '<artifact id="a1" kind="markdown" title="첫">A</artifact>\n' +
            '중간 텍스트\n' +
            '```python\n' + longBody + '\n```\n';
        const { cleanedContent, artifacts } = extractAndStripArtifacts(raw);
        expect(artifacts).toHaveLength(2);
        expect(artifacts[0].id).toBe('a1');
        expect(artifacts[1].id).toMatch(/^auto-python-/);
        expect(cleanedContent).toContain('[[artifact:a1]]');
        expect(cleanedContent).toContain('[[artifact:auto-python-');
    });

    it('title 자동 추출: code body 의 첫 def/class 이름', () => {
        const body = 'def my_function(x):\n' + Array.from({ length: 15 }, () => '    pass').join('\n');
        const raw = '```python\n' + body + '\n```';
        const { artifacts } = extractAndStripArtifacts(raw);
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].title).toBe('my_function');
    });

    it('빈 input 처리', () => {
        const { cleanedContent, artifacts } = extractAndStripArtifacts('');
        expect(cleanedContent).toBe('');
        expect(artifacts).toEqual([]);
    });

    it('artifact 태그가 없으면 변경 없음', () => {
        const raw = '일반 응답 텍스트만 있음';
        const { cleanedContent, artifacts } = extractAndStripArtifacts(raw);
        expect(cleanedContent).toBe(raw);
        expect(artifacts).toEqual([]);
    });
});

describe('placeholder 헬퍼 (유령 placeholder 가드)', () => {
    it('findArtifactPlaceholderIds: 본문의 placeholder id 를 순서대로 수집 (중복 제거, :vN 지원)', () => {
        const content =
            '앞 [[artifact:report-a]] 중간 [[artifact:chart-b:v3]] 반복 [[artifact:report-a]] 끝';
        expect(findArtifactPlaceholderIds(content)).toEqual(['report-a', 'chart-b']);
    });

    it('findArtifactPlaceholderIds: placeholder 없으면 빈 배열', () => {
        expect(findArtifactPlaceholderIds('일반 텍스트 [[not-artifact]] 포함')).toEqual([]);
    });

    it('stripArtifactPlaceholders: 지정 id 만 제거하고 다른 placeholder 는 유지', () => {
        const content = '유효 [[artifact:real-one]] / 유령 [[artifact:ghost-x]] [[artifact:ghost-x:v2]]';
        const out = stripArtifactPlaceholders(content, ['ghost-x']);
        expect(out).toContain('[[artifact:real-one]]');
        expect(out).not.toContain('ghost-x');
    });

    it('stripArtifactPlaceholders: 응답 전체가 유령 placeholder 인 경우 빈 문자열로', () => {
        const out = stripArtifactPlaceholders('[[artifact:kosu_prediction_report]]', ['kosu_prediction_report']);
        expect(out.trim()).toBe('');
    });

    it('stripArtifactPlaceholders: 정규식 특수문자가 든 id 도 안전하게 제거', () => {
        const id = 'weird.id+name';
        const out = stripArtifactPlaceholders(`x [[artifact:${id}]] y`, [id]);
        expect(out).toBe('x  y');
    });
});
