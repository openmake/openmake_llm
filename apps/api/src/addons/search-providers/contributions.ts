/**
 * search-providers add-on 이 Base 레지스트리에 기여하는 선언 — 운영 설정 키(관리자 설정 → 검색).
 * 순수 데이터다(다른 앱 모듈을 import 하지 않는다 — 설정 레지스트리가 부팅 초기에 읽는다).
 * 전부 런타임 반영(requiresRestart=false): provider 가 호출마다 값을 읽는다(settings.ts).
 *
 * @module addons/search-providers/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

const NAVER_DEV = 'https://developers.naver.com/apps';
const NCP_HUB = 'https://console.ncloud.com/naver-api-hub/application';

export const searchProvidersContribution: AddonContribution = {
    settings: [
        { key: 'NAVER_CLIENT_ID', group: 'search', secret: false, requiresRestart: false, validate: 'nonEmpty', issueUrl: NAVER_DEV },
        { key: 'NAVER_CLIENT_SECRET', group: 'search', secret: true, requiresRestart: false, validate: 'nonEmpty', issueUrl: NAVER_DEV },
        { key: 'NAVER_API_HUB_KEY_ID', group: 'search', secret: false, requiresRestart: false, validate: 'nonEmpty', issueUrl: NCP_HUB },
        { key: 'NAVER_API_HUB_KEY', group: 'search', secret: true, requiresRestart: false, validate: 'apiKey', issueUrl: NCP_HUB },
        { key: 'NAVER_API_DAILY_LIMIT', group: 'search', secret: false, requiresRestart: false, validate: 'nonNegativeInt' },
        { key: 'KAKAO_REST_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: 'apiKey', issueUrl: 'https://developers.kakao.com/console/app' },
        { key: 'EXA_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: 'apiKey', issueUrl: 'https://dashboard.exa.ai/api-keys' },
        { key: 'TAVILY_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: 'apiKey', issueUrl: 'https://app.tavily.com/home' },
    ],
};
