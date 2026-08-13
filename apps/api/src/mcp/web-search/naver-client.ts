/**
 * ============================================================
 * 네이버 검색 API 요청 조립 — legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드
 * ============================================================
 *
 * 2026-06-29 공지로 Search API 가 NCP NAVER API HUB 로 이관됨(기존 개발자센터 키는
 * 2027-06-30 까지 유예). `NAVER_API_HUB_KEY_ID`/`NAVER_API_HUB_KEY` 가 설정되면
 * HUB 경로(NCP 게이트웨이 헤더)를, 아니면 legacy 경로를 사용한다 — env 제거만으로
 * 즉시 롤백 가능한 점진 전환. 파라미터·응답 JSON 계약은 양쪽 동일(문서 실측).
 *
 * 일일 한도 가드: `NAVER_API_DAILY_LIMIT`(기본 25,000 — 공식 문서의 일일 허용량)
 * 도달 시 요청을 만들지 않고 null 을 반환한다 → 호출부는 빈 배열 graceful.
 * 무료 한도 초과분이 과금으로 이어지지 않게 하는 안전망. KVStore calendar-bucket
 * (llm/user-quota 관용구) — 멀티프로세스 정합, KVStore 장애 시 fail-open(호출 허용).
 * 버킷 경계는 KST 자정(네이버 한도 리셋 기준) 정렬.
 *
 * @module mcp/web-search/naver-client
 */
import { getConfig } from '../../config';
import { getKeyValueStore } from '../../storage';
import { createLogger } from '../../utils/logger';

const logger = createLogger('NaverClient');

/** legacy 개발자센터 엔드포인트 (경로에 `.json` 확장자, X-Naver-* 헤더) */
const LEGACY_BASE_URL = 'https://openapi.naver.com/v1/search';
/** NAVER API HUB 엔드포인트 (NCP API Gateway, `format=json` 기본이라 확장자 없음) */
const HUB_BASE_URL = 'https://naverapihub.apigw.ntruss.com/search/v1';

const DAY_MS = 24 * 60 * 60 * 1000;
/** KST(UTC+9) 자정 기준 일일 버킷 — 네이버 일일 한도 리셋과 정렬 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 버킷 경계 직후에도 직전 버킷 조회 가능하도록 2배 TTL (user-quota 관용구) */
const DAY_TTL_MS = 2 * DAY_MS;

function dayKey(now: number): string {
    return `naverq:d:${Math.floor((now + KST_OFFSET_MS) / DAY_MS)}`;
}

export type NaverSearchEndpoint = 'news' | 'webkr' | 'encyc';

export interface NaverSearchRequest {
    url: string;
    headers: Record<string, string>;
    /** 어느 경로를 탔는지 — 로그/테스트 관측용 */
    route: 'hub' | 'legacy';
}

/**
 * 오늘 버킷에 1 증가 후 한도 검사. 한도 도달이면 false (요청 차단).
 * 증가가 먼저라 race-free — 한도 초과 시 카운터가 한도를 넘겨 있지만 요청은 안 나간다.
 */
async function underDailyLimit(now: number): Promise<boolean> {
    const limit = getConfig().naverApiDailyLimit;
    if (limit <= 0) return true; // 0 = 무제한 (가드 해제)
    try {
        const store = getKeyValueStore();
        const key = dayKey(now);
        const used = await store.incrBy(key, 1);
        void store.expire(key, DAY_TTL_MS);
        if (used > limit) {
            // 하루 한 번만 경고가 도배되지 않도록 초과 직후 구간만 로그
            if (used <= limit + 3) {
                logger.warn(`네이버 검색 일일 한도(${limit}) 도달 — 오늘 호출 차단 (KST 자정 리셋)`);
            }
            return false;
        }
        return true;
    } catch (e) {
        logger.warn('네이버 일일 한도 검사 실패 (fail-open):', e);
        return true;
    }
}

/**
 * 네이버 검색 요청 조립. 키 미설정/일일 한도 도달이면 null → 호출부는 빈 배열 graceful.
 *
 * @param endpoint - 'news' | 'webkr'
 * @param queryString - `query=...&display=...` 형태의 인코딩 완료 쿼리스트링
 */
export async function buildNaverSearchRequest(
    endpoint: NaverSearchEndpoint,
    queryString: string,
    now: number = Date.now(),
): Promise<NaverSearchRequest | null> {
    const cfg = getConfig();

    let req: NaverSearchRequest;
    if (cfg.naverApiHubKeyId && cfg.naverApiHubKey) {
        req = {
            url: `${HUB_BASE_URL}/${endpoint}?${queryString}`,
            headers: {
                'X-NCP-APIGW-API-KEY-ID': cfg.naverApiHubKeyId,
                'X-NCP-APIGW-API-KEY': cfg.naverApiHubKey,
            },
            route: 'hub',
        };
    } else if (cfg.naverClientId && cfg.naverClientSecret) {
        req = {
            url: `${LEGACY_BASE_URL}/${endpoint}.json?${queryString}`,
            headers: {
                'X-Naver-Client-Id': cfg.naverClientId,
                'X-Naver-Client-Secret': cfg.naverClientSecret,
            },
            route: 'legacy',
        };
    } else {
        return null; // 키 미설정 — 기존 graceful 동작 유지
    }

    if (!(await underDailyLimit(now))) return null;
    return req;
}
