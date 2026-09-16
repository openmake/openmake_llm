import { buildCloneMetadata } from '../conversation-sessions';

describe('buildCloneMetadata (F08 PR-6)', () => {
    test('WS branchFrom* 규격(parentSessionId/parentMessageId/forkedAt) + kind clone', () => {
        const now = new Date('2026-09-17T00:00:00Z');
        expect(buildCloneMetadata('s1', '42', now)).toEqual({ parentSessionId: 's1', parentMessageId: '42', forkedAt: now.toISOString(), kind: 'clone' });
        expect(buildCloneMetadata('s1', null, now)).toEqual({ parentSessionId: 's1', forkedAt: now.toISOString(), kind: 'clone' });
    });
});
