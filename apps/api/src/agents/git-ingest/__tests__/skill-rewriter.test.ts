import {
    buildToolMappingHint,
    parseRewriteResponse,
    isAcceptableRewrite,
    proposeSkillRewrite,
} from '../skill-rewriter';
import type { LLMClient } from '../../../llm/client';

describe('skill-rewriter', () => {
    describe('buildToolMappingHint', () => {
        it('본문에 등장하는 도구만 대응표에 싣는다', () => {
            const hint = buildToolMappingHint('Use the `Bash` command and the Read tool.');
            expect(hint).toContain('`Bash` → `bash`');
            expect(hint).toContain('`Read` → `file_ops`');
            expect(hint).not.toContain('WebFetch');
        });

        it('대응 도구가 없으면 그렇게 표기', () => {
            expect(buildToolMappingHint('use `NotebookEdit` here')).toContain('대응 도구 없음');
        });

        it('도구 언급이 없으면 빈 문자열', () => {
            expect(buildToolMappingHint('일반적인 지침 본문입니다.')).toBe('');
        });
    });

    // 마커 기반 — 본문에 코드블록·백틱·따옴표가 섞여도 이스케이프가 필요 없다
    // (JSON 형식일 때 정상 종료했는데도 parse 실패하던 실측 사례로 전환, 2026-08-24)
    describe('parseRewriteResponse', () => {
        it('마커 파싱 (요약 + 본문)', () => {
            const r = parseRewriteResponse([
                '===CHANGED=== yes',
                '===SUMMARY===',
                '- 도구 이름 교체',
                '- 경로 조정',
                '===CONTENT===',
                '# 제목',
                '본문입니다.',
            ].join('\n'));
            expect(r).toEqual({
                changed: true,
                content: '# 제목\n본문입니다.',
                summary: ['도구 이름 교체', '경로 조정'],
            });
        });

        it('changed=no 면 본문 없이 종료', () => {
            expect(parseRewriteResponse('===CHANGED=== no')).toEqual({ changed: false, content: '', summary: [] });
        });

        it('본문의 코드블록·따옴표·백슬래시를 그대로 보존 (이스케이프 불필요)', () => {
            const body = '```bash\nrm -rf "$dir" \\\n  --force\n```\n\n`Read` 도구를 쓰세요.';
            const r = parseRewriteResponse(`===CHANGED=== yes\n===SUMMARY===\n- x\n===CONTENT===\n${body}`);
            expect(r?.content).toBe(body.trimEnd());
        });

        // 바깥 펜스를 벗기면 본문이 코드블록으로 시작/끝날 때 훼손된다 — 벗기지 않는다
        it('바깥 펜스는 벗기지 않는다 (본문 파손 방지)', () => {
            const r = parseRewriteResponse('===CHANGED=== yes\n===CONTENT===\n```\n# 본문\n```');
            expect(r?.content).toBe('```\n# 본문\n```');
        });

        it('요약이 없어도 본문만 있으면 유효', () => {
            const r = parseRewriteResponse('===CHANGED=== yes\n===CONTENT===\n본문');
            expect(r).toEqual({ changed: true, content: '본문', summary: [] });
        });

        it('마커 없음·빈 응답·changed=yes 인데 본문 없음 → null', () => {
            expect(parseRewriteResponse('그냥 텍스트')).toBeNull();
            expect(parseRewriteResponse('')).toBeNull();
            expect(parseRewriteResponse('===CHANGED=== yes\n===SUMMARY===\n- x')).toBeNull();
        });
    });

    describe('isAcceptableRewrite', () => {
        const original = 'a'.repeat(1000);

        it('충분한 길이의 변경본은 수용', () => {
            expect(isAcceptableRewrite(original, 'b'.repeat(900))).toBe(true);
        });

        it('요약해버린 제안은 거부 (내용 소실 방지)', () => {
            expect(isAcceptableRewrite(original, 'b'.repeat(300))).toBe(false);
        });

        it('빈 값·동일 내용은 거부', () => {
            expect(isAcceptableRewrite(original, '')).toBe(false);
            expect(isAcceptableRewrite(original, original)).toBe(false);
        });
    });

    describe('proposeSkillRewrite', () => {
        const body = '이 스킬은 `Bash` 도구를 씁니다.\n'.repeat(40);

        function mockLlm(content: string) {
            return { chat: jest.fn().mockResolvedValue({ content, metrics: { completion_tokens: 10 } }) } as unknown as Pick<LLMClient, 'chat'>;
        }

        it('변경 제안을 반환', async () => {
            const proposed = body.replace(/`Bash`/g, '`bash`');
            const llm = mockLlm(`===CHANGED=== yes\n===SUMMARY===\n- 도구 이름 교체\n===CONTENT===\n${proposed}`);
            const r = await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' });
            expect(r?.content).toBe(proposed.trimEnd());
            expect(r?.summary).toEqual(['도구 이름 교체']);
        });

        it('changed=no 면 제안 없음', async () => {
            const llm = mockLlm('===CHANGED=== no');
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('내용이 급감하면 제안을 버린다', async () => {
            const llm = mockLlm('===CHANGED=== yes\n===CONTENT===\n짧은 요약');
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('LLM 오류는 fail-open (null)', async () => {
            const llm = { chat: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as Pick<LLMClient, 'chat'>;
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('검사 대상을 경계 태그로 감싸 전달', async () => {
            const llm = mockLlm('===CHANGED=== no');
            await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' });
            const messages = (llm.chat as jest.Mock).mock.calls[0][0];
            expect(messages[1].content).toContain('<skill_body>');
            expect(messages[1].content).toContain('</skill_body>');
        });
    });
});
