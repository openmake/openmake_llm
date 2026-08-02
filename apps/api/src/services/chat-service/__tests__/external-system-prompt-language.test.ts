/**
 * 응답 언어 지시 회귀 테스트 (2026-08-02).
 *
 * 검색 결과 스니펫 언어에 끌려 한글 문장에 한자·간체자가 섞이던 결함
 * (실측 6건 중 3건, 운영 30일 502건 중 53건) 대응으로 지시를 대상 언어로
 * 작성하고 시스템 프롬프트 맨 끝으로 옮겼다. 두 성질 모두 회귀 감시 대상.
 */
import { buildExternalSystemPrompt } from '../external-system-prompt';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ResolvedProvider } from '../../../providers/provider-router';

const resolved = { fullId: 'local-llm:qwen3.6-35b-a3b' } as ResolvedProvider;
const baseReq = { message: '중국 경제 동향 알려줘' } as ChatMessageRequest;

function build(ctx: Record<string, unknown>) {
    return buildExternalSystemPrompt({
        req: baseReq,
        resolved,
        ctx: ctx as never,
        wantsMap: false,
        orchestration: { discussion: false, taskDelegate: false },
    });
}

describe('buildExternalSystemPrompt — 응답 언어 지시', () => {
    it('한국어는 한국어 지시문으로 주입한다', () => {
        const p = build({ resolvedLanguage: 'ko' });
        expect(p).toContain('[필수] 응답 언어: 한국어');
        expect(p).toContain('한글 이외의 문자');
    });

    it('검색 결과가 다른 언어여도 옮겨 쓰라는 조건을 명시한다', () => {
        // 혼입의 실제 트리거가 검색 스니펫 언어였으므로 이 문장이 지시의 핵심이다.
        expect(build({ resolvedLanguage: 'ko' })).toContain('다른 언어(중국어·일본어·영어)여도');
    });

    it('언어 지시는 시스템 프롬프트의 맨 끝에 위치한다', () => {
        const p = build({ resolvedLanguage: 'ko' });
        const idx = p.indexOf('[필수] 응답 언어');
        expect(idx).toBeGreaterThan(-1);
        // 뒤에 남는 것은 지시문 자신뿐 — 다른 블록이 뒤따르지 않아야 한다.
        expect(p.slice(idx)).not.toContain('현재 사용 중인 모델');
    });

    it('비한국어는 해당 언어명으로 영어 지시문을 주입한다', () => {
        const p = build({ resolvedLanguage: 'ja' });
        expect(p).toContain('[REQUIRED] Response language: 日本語');
        expect(p).not.toContain('[필수] 응답 언어');
    });

    it('언어를 알 수 없으면 지시를 주입하지 않는다', () => {
        const p = build({});
        expect(p).not.toContain('[필수] 응답 언어');
        expect(p).not.toContain('[REQUIRED] Response language');
    });
});
