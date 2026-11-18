/**
 * 데스크톱 Companion 설치 파일 게시 정보 계약 — GET /api/desktop/latest (공개 라우트).
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다. 게시본이 없거나 매니페스트가 올바르지 않으면 404.
 */

/** OS 하나의 게시본. `url` 은 서버가 만든 받기 주소(`/api/desktop/download/<file>`) — 소비자는 조립하지 않는다. */
export interface DesktopReleaseBlock {
  version: string;
  file: string;
  /** 매니페스트에 해시가 없으면 null. */
  sha256: string | null;
  url: string;
}

/**
 * data — 블록은 게시된 것만 실린다. `native` = macOS 옛 정체성(OpenMake Companion, 옛 앱 업데이터용),
 * `macos` = macOS 새 정체성(OpenMake Code), `windows` = Windows.
 * 최상위 값은 native 의 복제(구 업데이터 호환) — 웹은 블록만 읽고, macOS 줄은 `macos` 가 있으면 그것을 그린다.
 */
export type DesktopLatestPayload = Partial<DesktopReleaseBlock> & {
  native?: DesktopReleaseBlock;
  macos?: DesktopReleaseBlock;
  windows?: DesktopReleaseBlock;
};
