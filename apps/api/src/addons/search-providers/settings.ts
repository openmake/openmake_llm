/**
 * search-providers add-on 의 설정 읽기 — 키는 contributions.ts 가 관리자 설정에 기여하고, 값은 호출마다 읽는다
 * (DB overlay > env. 런타임 변경이 다음 검색부터 닿는다). 기본값·범위 보정은 여기 한 곳.
 *
 * @module addons/search-providers/settings
 */
import { readSettingValue } from '../../config/env';

const DEFAULT_NAVER_DAILY_LIMIT = 25000;
const DEFAULT_SUPPLEMENTARY_RATIO = 0.9;

const text = (key: string): string => readSettingValue(key) ?? '';

export interface SearchProviderSettings {
    naverClientId: string;
    naverClientSecret: string;
    naverApiHubKeyId: string;
    naverApiHubKey: string;
    /** 네이버 일일 호출 한도 — 0 = 무제한(가드 해제) */
    naverApiDailyLimit: number;
    /**
     * 보조 endpoint(encyc)가 일일 한도에서 쓸 수 있는 비율(0~1) — 소프트 컷에 닿으면 백과만 먼저 멈추고
     * 핵심(news/webkr)은 하드 한도까지 계속 돈다. env: NAVER_SUPPLEMENTARY_QUOTA_RATIO
     */
    naverSupplementaryRatio: number;
    kakaoRestApiKey: string;
    exaApiKey: string;
    tavilyApiKey: string;
}

export function searchProviderSettings(): SearchProviderSettings {
    const limit = Number(readSettingValue('NAVER_API_DAILY_LIMIT'));
    const ratio = Number(readSettingValue('NAVER_SUPPLEMENTARY_QUOTA_RATIO'));
    return {
        naverClientId: text('NAVER_CLIENT_ID'),
        naverClientSecret: text('NAVER_CLIENT_SECRET'),
        naverApiHubKeyId: text('NAVER_API_HUB_KEY_ID'),
        naverApiHubKey: text('NAVER_API_HUB_KEY'),
        naverApiDailyLimit: readSettingValue('NAVER_API_DAILY_LIMIT') !== undefined && Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_NAVER_DAILY_LIMIT,
        naverSupplementaryRatio: readSettingValue('NAVER_SUPPLEMENTARY_QUOTA_RATIO') !== undefined && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : DEFAULT_SUPPLEMENTARY_RATIO,
        kakaoRestApiKey: text('KAKAO_REST_API_KEY'),
        exaApiKey: text('EXA_API_KEY'),
        tavilyApiKey: text('TAVILY_API_KEY'),
    };
}
