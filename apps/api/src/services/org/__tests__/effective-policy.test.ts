/**
 * 유효 정책 병합 규칙 (F22 Phase C-1) — 조직 정책은 글로벌을 더 제한할 수만 있다.
 */
import { mergeExternalModelPolicy, strictestApprovalPolicy, parseOrgPolicyRows } from '../effective-policy';
import { isExternalModelAllowed } from '../../../config/external-model-policy';

describe('mergeExternalModelPolicy', () => {
    const G = { allow: [] as string[], deny: ['openrouter:*'] };
    test('조직 없음 → 글로벌 그대로', () => {
        expect(mergeExternalModelPolicy(G)).toBe(G);
    });
    test('deny 는 합집합 — 조직이 글로벌 차단을 풀 수 없다', () => {
        const m = mergeExternalModelPolicy(G, { allow: [], deny: ['nvidia:*'] });
        expect(isExternalModelAllowed('openrouter:x', m)).toBe(false);
        expect(isExternalModelAllowed('nvidia:x', m)).toBe(false);
        expect(isExternalModelAllowed('chatgpt:x', m)).toBe(true);
    });
    test('allow 는 한쪽만 있으면 그쪽', () => {
        const m = mergeExternalModelPolicy({ allow: [], deny: [] }, { allow: ['chatgpt:*'], deny: [] });
        expect(isExternalModelAllowed('chatgpt:gpt', m)).toBe(true);
        expect(isExternalModelAllowed('hasa:x', m)).toBe(false);
    });
    test('allow 둘 다 있으면 교집합, 비면 전부 차단', () => {
        const m = mergeExternalModelPolicy({ allow: ['chatgpt:*', 'hasa:*'], deny: [] }, { allow: ['hasa:*'], deny: [] });
        expect(isExternalModelAllowed('hasa:x', m)).toBe(true);
        expect(isExternalModelAllowed('chatgpt:x', m)).toBe(false);
        const empty = mergeExternalModelPolicy({ allow: ['chatgpt:*'], deny: [] }, { allow: ['hasa:*'], deny: [] });
        expect(isExternalModelAllowed('chatgpt:x', empty)).toBe(false);
        expect(isExternalModelAllowed('hasa:x', empty)).toBe(false);
    });
});

describe('strictestApprovalPolicy', () => {
    test.each([
        [undefined, undefined, undefined],
        ['none', undefined, 'none'],
        [undefined, 'high-risk', 'high-risk'],
        ['none', 'high-risk', 'high-risk'],
        ['all', 'high-risk', 'all'],
        ['high-risk', 'all', 'all'],
    ] as const)('(%s, min %s) → %s', (req, min, out) => {
        expect(strictestApprovalPolicy(req, min)).toBe(out);
    });
});

describe('parseOrgPolicyRows', () => {
    test('검증 통과 값만 채우고 잘못된 값·미지 키는 무시', () => {
        const set = parseOrgPolicyRows([
            { key: 'EXTERNAL_MODEL_POLICY', value: { deny: ['openrouter:*'] } },
            { key: 'TOOL_APPROVAL_POLICY_MIN', value: 'bogus' },
            { key: 'MCP_ALLOWED_SERVERS', value: [] },
            { key: 'SOMETHING_ELSE', value: 1 },
        ]);
        expect(set.externalModel).toEqual({ allow: [], deny: ['openrouter:*'] });
        expect(set.approvalPolicyMin).toBeUndefined();
        expect(set.mcpAllowedServers).toBeUndefined();
    });
});
