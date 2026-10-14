/**
 * ============================================================
 * 채팅 턴 첨부 → 위임 작업 입력 변환
 * ============================================================
 *
 * 채팅 턴의 첨부는 fileContext 문자열로만 녹아 delegate_agent_task 가 만든 작업의 샌드박스에는 파일이 없었다.
 * 문서 추출(doc-extractor)이 data 를 지우기 전에 보관한 원본을 되살려, 작업 생성 라우트(agent-task.routes)와
 * 같은 모양(name·type·size·content·truncated·data(원본)·extracted)으로 만든다 — 실행 때 uploads/ 에 원본이 쓰인다.
 *
 * @module services/chat-service/turn-attachments
 */
import type { AttachedFileInput } from './attach-context';
import type { AgentTaskInputFile } from '../agent-task/types';
import type { ChatTurnAttachments } from '../chat-service-types';
import { buildImageDataUrl } from '../../utils/image-mime';

/**
 * @param files - 추출을 마친 첨부(텍스트는 content, 추출된 문서는 content 가 채워지고 data 는 지워진 상태)
 * @param images - 이번 턴 이미지(raw base64·data URL·외부 URL)
 * @param originalData - 추출 전 files[i].data(base64 원본) — 같은 순서
 * @returns 넘길 첨부가 없으면 undefined
 */
export function buildTurnAttachments(
    files: AttachedFileInput[] | undefined,
    images: string[] | undefined,
    originalData: Array<string | undefined> = [],
): ChatTurnAttachments | undefined {
    const outFiles: AgentTaskInputFile[] = (files ?? []).map((f, i) => {
        const data = typeof originalData[i] === 'string' && originalData[i]!.length > 0 ? originalData[i] : undefined;
        return {
            name: f.name,
            type: f.type,
            size: f.size,
            content: f.content,
            truncated: f.truncated,
            ...(data ? { data } : {}),
            ...(data && typeof f.content === 'string' ? { extracted: true } : {}),
        };
    });
    // 작업 입력 이미지는 data:image/ URL 만 받는다(uploads/ 에 원본 바이트로 쓴다) — 외부 URL 은 뺀다
    const outImages = (images ?? [])
        .filter((s) => typeof s === 'string' && s.length > 0)
        .map(buildImageDataUrl)
        .filter((s) => s.startsWith('data:image/'));
    if (outFiles.length === 0 && outImages.length === 0) return undefined;
    return {
        ...(outFiles.length > 0 ? { files: outFiles } : {}),
        ...(outImages.length > 0 ? { images: outImages } : {}),
    };
}
