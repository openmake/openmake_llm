/**
 * 확장 설치 미리보기(M1b, 마켓플레이스 계획 v3.7 §3) 플래그.
 *
 * `EXTENSION_INSTALL_PREVIEW_ENABLED`(기본 OFF, system_settings 실시간) — 켜면 갤러리 카탈로그 설치 버튼이 먼저
 * `POST /api/users/me/extensions/catalog/:id/preview`(쓰기·LLM 없음)로 설치될 구성요소·권한·원본·커밋·경고를 보여 주고,
 * 확인하면 종전 설치를 부른다. 꺼져 있으면 미리보기 라우트는 404, 갤러리 응답에 플래그 필드도 없다(종전 흐름 그대로).
 *
 * @module config/extension-install-preview
 */
import { getConfig } from './env';

export const EXTENSION_INSTALL_PREVIEW_FLAG = 'EXTENSION_INSTALL_PREVIEW_ENABLED';

export function extensionInstallPreviewEnabled(): boolean {
    return getConfig().extensionInstallPreviewEnabled;
}
