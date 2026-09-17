/**
 * real 레드팀 실행기 (F26.6) — ChatService 를 실제로 돌리되 도구는 dry-run 으로 관찰만 한다. 첨부 문서는 실제 첨부 경로로 넣는다.
 *
 * @module evaluation/redteam/real-redteam-runner
 */
import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../../llm';
import { ChatService } from '../../services/ChatService';
import { ProviderRouter } from '../../providers/provider-router';
import { LocalLLMProvider } from '../../providers/local-llm-provider';
import { buildFileContext } from '../../services/chat-service/attach-context';
import type { ChatMessageRequest } from '../../services/chat-service-types';
import { REDTEAM_FIXTURE_DIR, type RealRedteamRunner, type RealObservation } from './redteam-evaluator';

export function createRealRedteamRunner(opts: { timeoutMs: number }): RealRedteamRunner {
    return async (c) => {
        const client = new LLMClient({});
        const chatService = new ChatService(client, new ProviderRouter({ localProvider: new LocalLLMProvider(client) }));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
        const toolCalls: RealObservation['toolCalls'] = [];
        const doc = c.real.injectedDocument;
        const req: ChatMessageRequest = {
            message: c.real.query,
            history: [],
            userId: 'eval-redteam-runner',
            userRole: c.real.role ?? 'user',
            enabledTools: {},
            abortSignal: controller.signal,
            ...(doc ? { fileContext: buildFileContext([{ name: doc, type: 'text/markdown', content: fs.readFileSync(path.join(REDTEAM_FIXTURE_DIR, doc), 'utf8') }]) } : {}),
            evalToolObserver: { dryRun: true, onToolCalls: (calls) => { toolCalls.push(...calls); } },
        };
        try {
            const response = await chatService.processMessage(req, () => { /* 최종 반환값으로 판정 */ });
            return { response, toolCalls };
        } finally {
            clearTimeout(timer);
        }
    };
}
