/**
 * 외부 MCP 도구 스키마 정규화 — `$ref` 가 가리키는 최상위 정의(`$defs`·`definitions`)를 인라인으로 푼다.
 * 종전에는 properties·required 만 남기고 최상위 정의를 버려, 참조가 끊긴 스키마가 모델에 갔다.
 */
import { sdkToolToMCPTool, inlineLocalRefs } from '../tool-schema';

describe('inlineLocalRefs', () => {
    it('$defs 참조를 정의 내용으로 바꾸고 참조 옆의 설명은 남긴다', () => {
        const out = inlineLocalRefs({
            type: 'object',
            properties: {
                filter: { $ref: '#/$defs/Filter', description: '검색 조건' },
                tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
            },
            $defs: {
                Filter: { type: 'object', properties: { tag: { $ref: '#/$defs/Tag' } }, required: ['tag'] },
                Tag: { type: 'string', enum: ['a', 'b'] },
            },
        });
        expect(out).toEqual({
            type: 'object',
            properties: {
                filter: { type: 'object', properties: { tag: { type: 'string', enum: ['a', 'b'] } }, required: ['tag'], description: '검색 조건' },
                tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
            },
        });
    });

    it('draft-07 의 definitions 참조와 anyOf 안의 참조도 푼다', () => {
        const out = inlineLocalRefs({
            type: 'object',
            properties: { who: { anyOf: [{ $ref: '#/definitions/User' }, { type: 'null' }] } },
            definitions: { User: { type: 'object', properties: { id: { type: 'integer' } } } },
        });
        expect(out.properties).toEqual({ who: { anyOf: [{ type: 'object', properties: { id: { type: 'integer' } } }, { type: 'null' }] } });
        expect(out).not.toHaveProperty('definitions');
    });

    it('이름이 definitions·$defs 인 인자는 정의로 보지 않고 그대로 둔다', () => {
        const out = inlineLocalRefs({ type: 'object', properties: { definitions: { type: 'string' }, $defs: { type: 'number' } } });
        expect(out.properties).toEqual({ definitions: { type: 'string' }, $defs: { type: 'number' } });
    });

    it('자기 참조(순환)는 한 번만 풀고 끊는다 — 무한히 펼치지 않는다', () => {
        const out = inlineLocalRefs({
            type: 'object',
            properties: { root: { $ref: '#/$defs/Node' } },
            $defs: { Node: { type: 'object', properties: { name: { type: 'string' }, child: { $ref: '#/$defs/Node', description: '하위 노드' } } } },
        });
        expect(out.properties).toEqual({ root: { type: 'object', properties: { name: { type: 'string' }, child: { description: '하위 노드' } } } });
        expect(JSON.stringify(out)).not.toContain('$ref');
    });

    it('찾을 수 없는 참조·외부 참조는 참조만 떼고 나머지를 남긴다', () => {
        const out = inlineLocalRefs({ type: 'object', properties: { a: { $ref: '#/$defs/Missing', description: 'x' }, b: { $ref: 'https://example.com/s.json' } } });
        expect(out.properties).toEqual({ a: { description: 'x' }, b: {} });
    });
});

describe('sdkToolToMCPTool', () => {
    it('참조를 풀어 properties 에 싣고 숨김 인자는 뺀다', () => {
        const tool = sdkToolToMCPTool({
            name: 'search', description: 'd',
            inputSchema: {
                type: 'object',
                properties: { q: { $ref: '#/$defs/Query' }, pluginWorkflowId: { type: 'string' } },
                required: ['q', 'pluginWorkflowId'],
                $defs: { Query: { type: 'string', minLength: 1 } },
            },
        });
        expect(tool).toEqual({
            name: 'search', description: 'd',
            inputSchema: { type: 'object', properties: { q: { type: 'string', minLength: 1 } }, required: ['q'] },
        });
    });

    it('스키마가 없으면 빈 object 스키마다', () => {
        expect(sdkToolToMCPTool({ name: 'ping' })).toEqual({ name: 'ping', description: '', inputSchema: { type: 'object', properties: {}, required: [] } });
    });
});
