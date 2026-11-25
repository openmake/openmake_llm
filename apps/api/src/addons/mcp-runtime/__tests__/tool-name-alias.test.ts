/**
 * 외부 스킬의 MCP 도구 표기 → 이 환경의 실제 이름 (2026-11-25, 확장 보안·연결 1단계).
 * 확장 MCP 서버는 `<확장>-<키>` 로 저장된다 — 스킬 본문의 `mcp__<키>__<도구>`·`<키>::<도구>` 가 그대로는 못 닿았다.
 */
import { looksLikeToolAlias, resolveToolNameAlias } from '../tool-name-alias';

const SEP = '::';

const known = [
    'web_search',
    'apollo-plugin-apollo::search_people',
    'apollo-plugin-apollo::enrich',
    'design-figma-a1b2c3::get_file',
    'github::create_issue',
    'team-a-github::create_issue',
    'team-b-linear::list',
    'team-c-linear::list',
];

describe('resolveToolNameAlias', () => {
    it('Claude Code 표기 mcp__<키>__<도구> → <확장>-<키>::<도구>', () => {
        expect(resolveToolNameAlias('mcp__apollo__search_people', known, SEP)).toEqual({ resolved: 'apollo-plugin-apollo::search_people' });
    });

    it('<키>::<도구> 표기도 같은 규칙으로', () => {
        expect(resolveToolNameAlias('apollo::enrich', known, SEP)).toEqual({ resolved: 'apollo-plugin-apollo::enrich' });
    });

    it('충돌 접미(-xxxxxx)는 떼고 비교한다', () => {
        expect(resolveToolNameAlias('mcp__figma__get_file', known, SEP)).toEqual({ resolved: 'design-figma-a1b2c3::get_file' });
    });

    it('이미 아는 이름은 해석하지 않는다', () => {
        expect(resolveToolNameAlias('github::create_issue', known, SEP)).toEqual({});
        expect(resolveToolNameAlias('web_search', known, SEP)).toEqual({});
    });

    it('서버 부분이 키와 똑같은 후보가 하나면 그것을 고른다', () => {
        expect(resolveToolNameAlias('mcp__github__create_issue', known, SEP)).toEqual({ resolved: 'github::create_issue' });
    });

    it('모호하면(접미 일치 후보 여럿) 잇지 않는다', () => {
        expect(resolveToolNameAlias('mcp__linear__list', known, SEP)).toEqual({
            ambiguous: ['team-b-linear::list', 'team-c-linear::list'],
        });
    });

    it('도구 이름은 추측하지 않는다 — 도구가 다르면 후보 없음', () => {
        expect(resolveToolNameAlias('mcp__apollo__search', known, SEP)).toEqual({});
    });

    it('키가 서버 이름 중간에만 있으면(끝이 아니면) 잇지 않는다', () => {
        expect(resolveToolNameAlias('mcp__plugin__enrich', known, SEP)).toEqual({});
    });

    it('별칭 형태가 아닌 이름은 대상이 아니다', () => {
        expect(looksLikeToolAlias('web_search', SEP)).toBe(false);
        expect(looksLikeToolAlias('mcp__a__b', SEP)).toBe(true);
        expect(looksLikeToolAlias('a::b', SEP)).toBe(true);
        expect(resolveToolNameAlias('nothing_here', known, SEP)).toEqual({});
    });
});
