/**
 * 기기 GPS 위치 컨텍스트 주입 (폰 기능 2단계, 2026-08-21).
 * userLocation 이 오면 system 프롬프트에 좌표 + search-places(x/y/radius) 안내가
 * 결정적으로 주입되고, 없으면 흔적이 없어야 한다.
 */
import { buildExternalSystemPrompt } from '../external-system-prompt';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ResolvedProvider } from '../../../providers/provider-router';

const resolved = { fullId: 'local-llm:qwen3.6-35b-a3b' } as ResolvedProvider;

function build(req: Partial<ChatMessageRequest>) {
    return buildExternalSystemPrompt({
        req: { message: '내 주변 카페 찾아줘', ...req } as ChatMessageRequest,
        resolved,
        ctx: { resolvedLanguage: 'ko' } as never,
        wantsMap: true,
        orchestration: { discussion: false, taskDelegate: false },
    });
}

describe('buildExternalSystemPrompt — userLocation 주입', () => {
    it('위치가 오면 좌표와 search-places x/y 안내가 주입된다', () => {
        const p = build({ userLocation: { lat: 37.504487, lng: 127.048957 } });
        expect(p).toContain('위도 37.504487');
        expect(p).toContain('경도 127.048957');
        expect(p).toContain('x(경도)');
        expect(p).toContain('y(위도)');
        expect(p).toContain('내 주변');
    });

    it('위치가 없으면 위치 블록이 없다', () => {
        const p = build({});
        expect(p).not.toContain('기기 GPS');
        expect(p).not.toContain('위도 ');
    });
});
