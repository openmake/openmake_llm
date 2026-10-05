/**
 * injectTaskInputs — 입력 첨부 주입(AgentTaskService 에서 분리한 구간의 동작 고정).
 */
import { injectTaskInputs } from './task-inputs';
import type { ChatMessage } from '../../llm/types';

const conv = (): ChatMessage[] => [{ role: 'system', content: 's' }, { role: 'user', content: '목표' }];

describe('injectTaskInputs', () => {
    it('첨부가 없으면 대화를 건드리지 않는다', async () => {
        const c = conv();
        await injectTaskInputs({}, c, null);
        expect(c).toEqual(conv());
    });

    it('샌드박스가 없으면 파일 내용을 goal 에 싣고, 이미지는 vision 채널로 준다', async () => {
        const c = conv();
        await injectTaskInputs({ files: [{ name: 'a.txt', content: '파일 본문' }], images: ['data:image/png;base64,AAAA'] }, c, null);
        expect(c[1].content).toContain('파일 본문');
        expect(c[1].images).toEqual(['data:image/png;base64,AAAA']);
    });

    it('재개면 goal 에 다시 싣지 않는다', async () => {
        const c = conv();
        await injectTaskInputs({ files: [{ name: 'a.txt', content: '파일 본문' }], resume: {} }, c, null);
        expect(c).toEqual(conv());
    });
});
