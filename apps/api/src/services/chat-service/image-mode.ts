/**
 * Image Mode — 이미지 생성 모드 결정적 경로
 *
 * 사용자가 컴포저의 '이미지' 토글을 켜고 메시지를 보내면, 그 메시지를 프롬프트로
 * generate_image 도구를 **직접 호출**해 이미지를 생성한다. LLM 의 도구 호출 결정에
 * 의존하지 않으므로, 일부 모델(qwen 등)이 도구를 호출/표시하지 않아 이미지가 안 보이던
 * 문제를 회피한다.
 *
 * @module services/chat-service/image-mode
 */
import { createLogger } from '../../utils/logger';
import { generateImageTool } from '../../mcp/image-tools';

const logger = createLogger('ImageMode');

/**
 * 메시지를 프롬프트로 이미지를 생성하고 마크다운(![](/generated/...))을 스트리밍 + 반환한다.
 * 반환 문자열은 상위 핸들러가 conversation 에 저장하고, onToken 으로 즉시 클라이언트에 표시한다.
 */
export async function generateImageInline(
    prompt: string,
    onToken: (token: string, thinking?: string) => void,
): Promise<string> {
    const result = await generateImageTool.handler({ prompt });
    const text = result.content?.[0]?.text ?? '';
    if (result.isError) {
        logger.warn(`이미지 생성 실패: ${text.slice(0, 120)}`);
        onToken(text);
        return text;
    }
    const m = text.match(/!\[[^\]]*\]\(\/generated\/[^)]+\)/);
    const response = m ? `요청하신 이미지를 생성했어요.\n\n${m[0]}` : text;
    logger.info('이미지 직접 생성 완료 (도구 직접 호출)');
    onToken(response);
    return response;
}
