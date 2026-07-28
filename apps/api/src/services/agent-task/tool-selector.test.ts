import { tokenizeGoal, scoreTool, selectRelevantTools } from './tool-selector';
import type { ToolDefinition } from '../../llm/types';

function tool(name: string, description = ''): ToolDefinition {
    return { type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } } };
}

const CATALOG: ToolDefinition[] = [
    tool('postgres_query', 'PostgreSQL 데이터베이스에서 SQL 을 실행해 행을 조회'),
    tool('notion_search', 'Notion 워크스페이스의 페이지를 검색'),
    tool('web_search', '웹을 검색해 결과를 반환'),
    tool('generate_image', '이미지를 생성'),
    tool('slack_send', 'Slack 채널에 메시지를 전송'),
];

describe('tokenizeGoal', () => {
    it('소문자화 + 2자 이상 + 중복 제거', () => {
        expect(tokenizeGoal('Postgres 에서 postgres 사용자 a')).toEqual(['postgres', '에서', '사용자']);
    });
    it('빈/기호만 입력은 빈 배열', () => {
        expect(tokenizeGoal('  !!! ')).toEqual([]);
    });
});

describe('scoreTool', () => {
    it('name 매칭이 description 매칭보다 가중(3 vs 1)', () => {
        expect(scoreTool(tool('postgres_query', ''), ['postgres'])).toBe(3);
        expect(scoreTool(tool('db_query', 'postgres 실행'), ['postgres'])).toBe(1);
    });
});

describe('selectRelevantTools', () => {
    it('관련 도구를 점수순으로 예산 내에서 선별', () => {
        const picked = selectRelevantTools('postgres 에서 사용자 수를 조회', CATALOG, { budget: 3 });
        expect(picked[0].function.name).toBe('postgres_query');
    });

    it('관련성 0 도구는 제외(예산 남아도 무관 도구 미포함)', () => {
        const picked = selectRelevantTools('notion 페이지 검색', CATALOG, { budget: 10 });
        const names = picked.map((t) => t.function.name);
        expect(names).toContain('notion_search');
        expect(names).not.toContain('generate_image');
        expect(names).not.toContain('slack_send');
    });

    it('exclude 된 도구는 제외', () => {
        const picked = selectRelevantTools('웹 검색', CATALOG, { budget: 5, exclude: new Set(['web_search']) });
        expect(picked.map((t) => t.function.name)).not.toContain('web_search');
    });

    it('budget 0 이하 또는 토큰 없음이면 빈 배열', () => {
        expect(selectRelevantTools('postgres', CATALOG, { budget: 0 })).toEqual([]);
        expect(selectRelevantTools('!!!', CATALOG, { budget: 5 })).toEqual([]);
    });

    it('budget 로 개수 제한', () => {
        const picked = selectRelevantTools('검색 search', CATALOG, { budget: 1 });
        expect(picked).toHaveLength(1);
    });
});
