/**
 * 조직 소유 확장 설치(마켓플레이스 계획 v3.5 P8) 플래그.
 *
 * `EXTENSION_ORG_OWNED_INSTALL_ENABLED`(기본 OFF, system_settings 실시간) — 켜면 활성 조직의 관리자(owner·admin)가
 * 확장을 **조직 소유**로 설치한다(212: user_id NULL + owner_org_id). 소유자가 사람이 아니라 조직이라 설치한 관리자가
 * 조직을 떠나거나 계정이 삭제돼도 행이 남고, 수정·업데이트·제거는 그 조직의 관리자 누구나 한다(감사 기록).
 * 권한 판정은 security/authorize 'org_extension'(config/resource-policy) 한 곳.
 * 조직 소유 행은 visibility='organization'·org_id = 소유 조직으로 저장돼 조직 공개 갤러리(listShared·getInstallableById)에
 * 같은 조건으로 함께 나온다 — 멤버는 종전처럼 갤러리에서 자기 계정으로 설치한다.
 *
 * 꺼져 있으면 조직 소유 라우트는 다음 라우트로 넘어가(종전과 같은 응답) 아무 것도 만들지 않는다.
 *
 * @module config/extension-org-owned
 */
import { getConfig } from './env';

export const EXTENSION_ORG_OWNED_INSTALL_FLAG = 'EXTENSION_ORG_OWNED_INSTALL_ENABLED';

export function extensionOrgOwnedInstallEnabled(): boolean {
    return getConfig().extensionOrgOwnedInstallEnabled;
}

/** 조직 소유 목록 상한 */
export const ORG_OWNED_LIST_LIMIT = 100;
