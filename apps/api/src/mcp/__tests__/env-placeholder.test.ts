/**
 * MCP env 자리표시자 판정 테스트.
 *
 * 회귀 방지 대상: 외부 플러그인의 `"${user_config.api_key}"` 가 자리표시자로 잡히지
 * 않으면 승인 시 그대로 저장되어 서버는 뜨지만 인증이 전부 실패한다(조용한 실패).
 */
import {
    isEnvPlaceholder,
    collectPlaceholderEnvKeys,
    parseUserConfigRef,
    buildEnvInputHints,
} from '../env-placeholder';

describe('isEnvPlaceholder', () => {
    it('빈 값·undefined·null 은 자리표시자', () => {
        expect(isEnvPlaceholder('')).toBe(true);
        expect(isEnvPlaceholder(undefined)).toBe(true);
        expect(isEnvPlaceholder(null)).toBe(true);
    });

    it('값 전체가 ${...} 이면 자리표시자', () => {
        expect(isEnvPlaceholder('${API_KEY}')).toBe(true);
        expect(isEnvPlaceholder('${user_config.api_key}')).toBe(true);
    });

    it('실제 값은 자리표시자가 아니다', () => {
        expect(isEnvPlaceholder('honggildong')).toBe(false);
        expect(isEnvPlaceholder('sk-abc123')).toBe(false);
    });

    it('부분 치환은 자리표시자로 보지 않는다 — 접두사를 통째로 다시 쓰게 만들지 않기 위해', () => {
        expect(isEnvPlaceholder('Bearer ${TOKEN}')).toBe(false);
        expect(isEnvPlaceholder('${HOST}:8080')).toBe(false);
    });
});

describe('collectPlaceholderEnvKeys', () => {
    it('자리표시자인 키만 추린다', () => {
        expect(collectPlaceholderEnvKeys({
            LAW_OC: '${user_config.api_key}',
            LOG_LEVEL: 'info',
            EMPTY: '',
        })).toEqual(['LAW_OC', 'EMPTY']);
    });

    it('env 가 없으면 빈 배열', () => {
        expect(collectPlaceholderEnvKeys(null)).toEqual([]);
        expect(collectPlaceholderEnvKeys(undefined)).toEqual([]);
        expect(collectPlaceholderEnvKeys({})).toEqual([]);
    });
});

describe('parseUserConfigRef', () => {
    it('userConfig 참조에서 키를 뽑는다', () => {
        expect(parseUserConfigRef('${user_config.api_key}')).toBe('api_key');
    });

    it('일반 자리표시자나 실제 값은 참조가 아니다', () => {
        expect(parseUserConfigRef('${API_KEY}')).toBeNull();
        expect(parseUserConfigRef('honggildong')).toBeNull();
        expect(parseUserConfigRef(undefined)).toBeNull();
    });
});

describe('buildEnvInputHints', () => {
    it('userConfig 의 title/description/sensitive 를 끌어온다 (korean-law 실사례)', () => {
        const hints = buildEnvInputHints(
            { LAW_OC: '${user_config.api_key}' },
            { api_key: { title: '법제처 API 키 (LAW_OC)', description: '무료 발급', sensitive: true } },
        );
        expect(hints).toEqual([
            { key: 'LAW_OC', title: '법제처 API 키 (LAW_OC)', description: '무료 발급', sensitive: true },
        ]);
    });

    it('참조가 아닌 자리표시자는 키 이름만 남긴다', () => {
        expect(buildEnvInputHints({ API_KEY: '${API_KEY}' }, undefined)).toEqual([
            { key: 'API_KEY', title: undefined, description: undefined, sensitive: undefined },
        ]);
    });

    it('값이 채워진 키는 입력 대상이 아니다', () => {
        expect(buildEnvInputHints({ LOG_LEVEL: 'info' }, undefined)).toEqual([]);
    });
});
