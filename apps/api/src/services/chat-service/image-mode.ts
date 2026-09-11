/**
 * Image Mode — 이미지 생성 모드 결정적 경로
 *
 * 사용자가 컴포저의 '이미지' 토글을 켜고 메시지를 보내면, 그 메시지를 프롬프트로
 * image.generate executor 를 **직접 호출**해 이미지를 생성한다(모달리티 도구 폐기, 2026-09-12). LLM 의 도구 호출 결정에
 * 의존하지 않으므로, 일부 모델(qwen 등)이 도구를 호출/표시하지 않아 이미지가 안 보이던
 * 문제를 회피한다.
 *
 * @module services/chat-service/image-mode
 */
import { createLogger } from '../../utils/logger';
import { imageGenerateExecutor } from '../orchestrator/executors/image';
import type { PlanTask } from '../orchestrator/plan-schema';
import type { ExecContext } from '../orchestrator/types';

const logger = createLogger('ImageMode');

/**
 * 메시지를 프롬프트로 이미지를 생성하고 마크다운(![](/generated/...))을 스트리밍 + 반환한다.
 * 반환 문자열은 상위 핸들러가 conversation 에 저장하고, onToken 으로 즉시 클라이언트에 표시한다.
 */
export async function generateImageInline(
    prompt: string,
    onToken: (token: string, thinking?: string) => void,
    opts: { userId?: string; lang?: string; signal?: AbortSignal } = {},
): Promise<string> {
    // 이미지 모드 토글은 Planner 를 거치지 않고 image.generate executor 를 직접 호출한다(사용자 명시 의도).
    const task: PlanTask = { id: 'image-mode', capability: 'image.generate', instruction: prompt, text: '', attachments: [], refs: [], dependsOn: [], extra: {} };
    const ctx: ExecContext = { userId: opts.userId, lang: opts.lang ?? 'ko', userMessage: prompt, attachments: new Map(), results: new Map(), signal: opts.signal };
    try {
        const out = await imageGenerateExecutor(task, ctx);
        const md = out.media[0]?.markdown ?? '';
        const response = md ? `요청하신 이미지를 생성했어요.\n\n${md}` : out.text;
        logger.info('이미지 직접 생성 완료 (executor 직접 호출)');
        onToken(response);
        return response;
    } catch (err) {
        const text = `이미지 생성 실패: ${err instanceof Error ? err.message : String(err)}`;
        logger.warn(text.slice(0, 160));
        onToken(text);
        return text;
    }
}
