/**
 * 서브에이전트 위임 규약 — 쓸 수 있는 도구 범위를 알려 준다.
 * 라이브 관측(2026-10-04): 실행 도구가 없는 서브가 "bash 로 파일 만드는 법"을 웹 검색하려다 승인 카드를 띄웠다.
 */
import { buildSubagentDelegationRules } from '../prompts/subagent-system';

describe('buildSubagentDelegationRules', () => {
    it('받은 도구 이름을 적고, 목록 밖의 일은 방법만 답하게 한다', () => {
        const rules = buildSubagentDelegationRules(3, ['web_search'], '한국어');
        expect(rules).toContain('web_search');
        expect(rules).toMatch(/셸 실행·파일 쓰기/);
        expect(rules).toMatch(/방법.*답/);
    });

    it('도구가 없으면 도구가 없다고 적는다', () => {
        const rules = buildSubagentDelegationRules(3, [], '한국어');
        expect(rules).toMatch(/쓸 수 있는 도구가 없습니다/);
        expect(rules).not.toContain('뿐입니다');
    });

    // 측정(2026-10-04, retired-chat-model): "위임 요청과 같은 언어로"만 두면 영문 토큰이 섞인 한국어 위임 2종에서 6/12 가 영어로 왔고,
    // 언어를 이름으로 짚으면 0/12 였다.
    it('응답 언어를 이름으로 짚는다', () => {
        expect(buildSubagentDelegationRules(3, ['web_search'], '한국어')).toMatch(/응답 언어: 한국어/);
        expect(buildSubagentDelegationRules(3, ['web_search'], 'English')).toMatch(/응답 언어: English/);
    });

    it('턴 상한·재위임 불가 규약은 그대로다', () => {
        const rules = buildSubagentDelegationRules(5, ['web_search', 'bash'], '한국어');
        expect(rules).toContain('최대 5턴');
        expect(rules).toContain('재위임할 수 없습니다');
        expect(rules).toContain('web_search, bash');
    });
});
