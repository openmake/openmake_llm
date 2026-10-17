import { logger } from "./config.js";
import type { DaumSearchResponse, KakaoCoord2AddressResponse, KakaoKeywordSearchResponse, KakaoPlaceDocument } from "./types.js";

// --- Helper Functions ---

export function formatPlacesResponse(data: KakaoKeywordSearchResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return "검색 결과가 없습니다.";
  }
  const places = data.documents.map((place: KakaoPlaceDocument) => {
    let result = `이름: ${place.place_name}\n주소: ${place.address_name}\n카테고리: ${place.category_name}`;
    
    // 전화번호가 있으면 추가
    if (place.phone) {
      result += `\n전화번호: ${place.phone}`;
    }
    
    // 카카오맵 링크 추가
    result += `\n상세정보: ${place.place_url}`;
    
    return result;
  }).join("\n---\n");
  
  const pageInfo = data.meta ? ` (결과 수: ${data.meta.pageable_count}, 총 ${data.meta.total_count}개)` : "";

  // 지도 렌더용 kakaomap 블록 — 좌표(x=lng, y=lat)를 가진 상위 결과를 JSON 으로 동봉한다.
  // 프론트(markdown.tsx)가 이 fenced 블록을 KakaoMap 컴포넌트로 렌더한다. 도구 결과에
  // "그대로 포함" 지시를 실어 모델이 블록을 변형 없이 통과시키게 한다(전역 프롬프트 불필요).
  const mapPoints = data.documents
    .filter(p => p.x && p.y)
    .slice(0, 15)
    .map(p => ({
      name: p.place_name,
      lat: Number(p.y),
      lng: Number(p.x),
      address: p.address_name,
      url: p.place_url,
    }));
  let mapBlock = "";
  if (mapPoints.length > 0) {
    const json = JSON.stringify({ places: mapPoints });
    mapBlock = `\n\n[지도 표시용 — 아래 kakaomap 블록을 답변에 변형 없이 그대로 포함하세요]\n\`\`\`kakaomap\n${json}\n\`\`\``;
  }

  return `장소 검색 결과${pageInfo}:\n${places}${mapBlock}`;
}

export function formatAddressResponse(data: KakaoCoord2AddressResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return "해당 좌표에 대한 주소 정보를 찾을 수 없습니다.";
  }
  const doc = data.documents[0];
  const roadAddress = doc.road_address ? `도로명: ${doc.road_address.address_name}` : "도로명 주소 정보 없음";
  const lotAddress = doc.address ? `지번: ${doc.address.address_name}` : "지번 주소 정보 없음";
  return `주소 변환 결과:\n${roadAddress}\n${lotAddress}`;
}

// 다음 검색 결과 포맷팅 함수
export function formatDaumSearchResponse(searchType: string, data: DaumSearchResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return '검색 결과가 없습니다.';
  }

  let result = `${searchType} 검색 결과 (총 ${data.meta.total_count}개 중 ${data.documents.length}개 표시):\n\n`;

  for (const [index, doc] of data.documents.entries()) {
    result += `${index + 1}. `;

    // 제목 처리
    const title = doc.title;
    const sitename = doc.display_sitename;
    if (typeof title === 'string' && title) {
      result += `${title.replace(/<b>/g, '').replace(/<\/b>/g, '')}\n`;
    } else if (typeof sitename === 'string' && sitename) {
      result += `${sitename}\n`;
    } else {
      result += '[제목 없음]\n';
    }

    // 내용 처리
    const contents = doc.contents;
    if (typeof contents === 'string' && contents) {
      const cleanContent = contents.replace(/<b>/g, '').replace(/<\/b>/g, '');
      result += `   내용: ${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}\n`;
    }

    // URL 처리
    if (typeof doc.url === 'string' && doc.url) {
      result += `   URL: ${doc.url}\n`;
    }

    // 날짜 처리
    const datetimeValue = doc.datetime;
    if (typeof datetimeValue === 'string' || typeof datetimeValue === 'number') {
      try {
        const datetime = new Date(datetimeValue);
        if (!Number.isNaN(datetime.getTime())) { // isNaN 대신 Number.isNaN 사용 및 유효성 검사 강화
          result += `   날짜: ${datetime.toLocaleDateString('ko-KR')}\n`;
        }
      } catch {
        logger.error(`Invalid date format for datetime: ${datetimeValue}`);
      }
    }

    // 이미지 URL 처리
    const thumbnailUrl = doc.thumbnail_url;
    const imageUrl = doc.image_url;
    if (typeof thumbnailUrl === 'string' || typeof imageUrl === 'string') {
      result += `   이미지: ${thumbnailUrl || imageUrl}\n`;
    }

    // 카페명 처리
    if (typeof doc.cafename === 'string' && doc.cafename) {
      result += `   카페: ${doc.cafename}\n`;
    }

    // 블로그명 처리
    if (typeof doc.blogname === 'string' && doc.blogname) {
      result += `   블로그: ${doc.blogname}\n`;
    }

    // 출처 처리
    if (typeof doc.collection === 'string' && doc.collection) {
      result += `   출처: ${doc.collection}\n`;
    }

    // 크기 처리
    if (typeof doc.width === 'number' && typeof doc.height === 'number') {
      result += `   크기: ${doc.width}x${doc.height}\n`;
    }

    result += '\n'; // 각 문서 사이에 줄바꿈 추가
  }

  // 페이지 정보 추가
  result += `현재 페이지가 마지막 페이지${data.meta.is_end ? '입니다.' : '가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.'}\n`;

  return result; // 함수 끝에 return 명시
}
