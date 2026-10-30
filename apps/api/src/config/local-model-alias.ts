/**
 * 로컬 모델 alias 해석 — 옛 로컬 ID → 카탈로그 정식 ID (2026-10-30, DGX 모델 전환).
 *
 * DGX 채팅 모델을 바꾸면(omk OMK_DGX_MODEL) 게이트웨이는 옛 이름·gpt-3.5-turbo 를 같은 upstream 의
 * 호환 라우트로 남기고, 발견(`local-models-discovery`)은 그 이름들을 정식 엔트리의 `aliases` 로 싣는다.
 * 옛 ID 로 들어온 요청(외부 OpenAI 호환 API·봇·CLI)의 배지·프로필·컨텍스트가 정식 ID 기준이 되도록
 * 이 함수 하나로 바꾼다. 정적 폴백 카탈로그에는 aliases 가 없어 게이트웨이 미도달이면 종전 동작(그대로).
 *
 * 카탈로그 상태는 `local-models.ts` 가 소유한다(그 파일 크기 게이트로 분리 — `findLocalModel` 이 이 함수를 부른다).
 *
 * @module config/local-model-alias
 */
import { createLogger } from '../utils/logger';
import { getLocalModels } from './local-models';

const logger = createLogger('LocalModelAlias');

/**
 * ① 정식 id 와 같으면 그대로 ② 정확히 한 엔트리의 aliases 에 있으면 그 엔트리 id ③ 그 외 그대로.
 * 정확 일치(대소문자 그대로). 정식 id 와 alias 가 겹치면 정식이 이긴다.
 */
export function resolveLocalModelId(id: string): string {
    const models = getLocalModels();
    if (models.some((m) => m.id === id)) return id;
    const owners = models.filter((m) => m.aliases?.includes(id));
    if (owners.length !== 1) return id;
    logger.debug(`로컬 모델 alias 해석: ${id} → ${owners[0].id}`);
    return owners[0].id;
}
