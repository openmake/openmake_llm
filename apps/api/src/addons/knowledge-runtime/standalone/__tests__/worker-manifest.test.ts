/**
 * 실제 매니페스트 — knowledge-ingest worker 선언이 이 add-on 의 runKnowledgeWorkerProcess 로 풀린다(Base 진입점이 쓰는 경로).
 */
import { loadAddonWorker } from '../../../../addon-host/worker-entry';
import { runKnowledgeWorkerProcess } from '../worker-process';

describe('knowledge-ingest worker 매니페스트', () => {
    it('이름으로 찾으면 knowledge-runtime 의 runKnowledgeWorkerProcess', () => {
        const { addonId, start } = loadAddonWorker('knowledge-ingest');
        expect(addonId).toBe('knowledge-runtime');
        expect(start).toBe(runKnowledgeWorkerProcess);
    });
});
