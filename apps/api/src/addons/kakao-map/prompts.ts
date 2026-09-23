/**
 * kakao-map add-on — 채팅 턴 통합에 주입하는 모델 지시 프롬프트 (L2).
 * 인라인 프롬프트 금지 규약에 따라 chat-integration.ts 에서 분리했다.
 *
 * @module addons/kakao-map/prompts
 */

/** 지도 의도 턴에 시스템 프롬프트로 주입 — qwen 이 web_search/자체 아티팩트로 이탈하는 것을 막는다. */
export const KAKAO_MAP_SYSTEM_PROMPT =
    '사용자가 국내(한국) 장소·위치·지도·길찾기를 묻고 있습니다. 이런 질문에는 반드시 ' +
    '카카오 도구(장소는 search-places, 길찾기는 find-route)를 먼저 호출해 실제 데이터를 ' +
    '얻으세요. 웹 검색이나 이미지 생성으로 좌표·위치를 추측하지 마세요. ' +
    '⚠️ 지도는 시스템이 도구 결과로 자동 표시하니, 당신은 kakaomap 코드 블록이나 좌표(lat/lng) ' +
    '목록을 절대 직접 작성하지 마세요. 사람이 읽을 요약(장소명·주소·거리·소요시간 등)만 작성하세요.';

/** 사용자 위치 좌표를 검색 도구 인자로 전달하도록 안내하는 힌트. */
export const KAKAO_MAP_USER_LOCATION_HINT =
    '카카오 장소 검색(search-places)을 쓸 때는 x(경도)·y(위도)·radius 인자에 이 좌표를 전달해 ' +
    '실제 주변 결과를 얻으세요. ';
