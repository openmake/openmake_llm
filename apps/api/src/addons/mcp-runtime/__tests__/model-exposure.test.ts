/**
 * describeModelExposure — "연결됨" 과 별개인 "모델에 노출됨" 조건.
 */
import { describeModelExposure } from '../model-exposure';

const base = { enabled: true, isGlobal: false, connectionStatus: 'connected', toolCount: 3 };
const policy = { breadthSlots: 0, progressive: true };

describe('describeModelExposure', () => {
    it('사용자 서버 + breadth 0 → 언급하면 노출, 그 밖엔 mcp_call', () => {
        expect(describeModelExposure(base, policy)).toEqual({ state: 'on_mention', viaMetaTools: true });
    });

    it('breadth 슬롯이 있으면 매 턴 자동 노출', () => {
        expect(describeModelExposure(base, { breadthSlots: 2, progressive: true }).state).toBe('auto');
    });

    it('전역 서버는 메타 도구로만, 메타 도구가 꺼져 있으면 노출 안 됨', () => {
        expect(describeModelExposure({ ...base, isGlobal: true }, policy)).toEqual({ state: 'on_demand', viaMetaTools: true });
        expect(describeModelExposure({ ...base, isGlobal: true }, { breadthSlots: 0, progressive: false }))
            .toEqual({ state: 'none', reason: 'meta_tools_off', viaMetaTools: false });
    });

    it('사용 안 함 · 연결 안 됨 · 도구 0개는 노출 안 됨(이유 포함)', () => {
        expect(describeModelExposure({ ...base, enabled: false }, policy)).toMatchObject({ state: 'none', reason: 'disabled' });
        expect(describeModelExposure({ ...base, connectionStatus: 'disconnected' }, policy)).toMatchObject({ state: 'none', reason: 'not_connected' });
        expect(describeModelExposure({ ...base, toolCount: 0 }, policy)).toMatchObject({ state: 'none', reason: 'no_tools' });
    });

    it('degraded 는 연결로 본다', () => {
        expect(describeModelExposure({ ...base, connectionStatus: 'degraded' }, policy).state).toBe('on_mention');
    });
});
