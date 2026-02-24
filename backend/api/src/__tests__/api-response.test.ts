/**
 * api-response.ts 단위 테스트
 * 표준 API 응답 헬퍼 함수 및 ErrorCodes 상수 검증
 */

import {
    success,
    error,
    paginated,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    validationError,
    rateLimited,
    internalError,
    serviceUnavailable,
    ErrorCodes,
} from '../utils/api-response';

// ===== success =====

describe('success', () => {
    test('success: true 포함', () => {
        const res = success({ id: 1 });
        expect(res.success).toBe(true);
    });

    test('data 포함', () => {
        const data = { name: 'test', value: 42 };
        const res = success(data);
        expect(res.data).toEqual(data);
    });

    test('meta.timestamp가 ISO 8601 문자열', () => {
        const res = success(null);
        expect(res.meta?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('추가 meta 병합 가능', () => {
        const res = success('data', { requestId: 'req-123' });
        expect(res.meta?.requestId).toBe('req-123');
        expect(res.meta?.timestamp).toBeDefined();
    });

    test('배열 data도 처리', () => {
        const items = [1, 2, 3];
        const res = success(items);
        expect(res.data).toEqual([1, 2, 3]);
    });

    test('undefined data 허용', () => {
        const res = success(undefined);
        expect(res.success).toBe(true);
        expect(res.data).toBeUndefined();
    });

    test('null data 허용', () => {
        const res = success(null);
        expect(res.success).toBe(true);
        expect(res.data).toBeNull();
    });
});

// ===== error =====

describe('error', () => {
    test('success: false 포함', () => {
        const res = error('ERR', 'message');
        expect(res.success).toBe(false);
    });

    test('error.code 포함', () => {
        const res = error('MY_ERROR', 'message');
        expect(res.error.code).toBe('MY_ERROR');
    });

    test('error.message 포함', () => {
        const res = error('CODE', 'some message');
        expect(res.error.message).toBe('some message');
    });

    test('meta.timestamp가 ISO 8601 문자열', () => {
        const res = error('CODE', 'msg');
        expect(res.meta?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('details 없으면 error.details는 undefined', () => {
        const res = error('CODE', 'msg');
        expect(res.error.details).toBeUndefined();
    });

    test('details 있으면 포함', () => {
        const details = { field: 'email', issue: 'invalid format' };
        const res = error('CODE', 'msg', details);
        expect(res.error.details).toEqual(details);
    });

    test('details에 배열도 허용', () => {
        const res = error('CODE', 'msg', ['err1', 'err2']);
        expect(res.error.details).toEqual(['err1', 'err2']);
    });
});

// ===== paginated =====

describe('paginated', () => {
    test('success: true 포함', () => {
        const res = paginated([1, 2], { page: 1, pageSize: 10, total: 2 });
        expect(res.success).toBe(true);
    });

    test('data는 전달한 items', () => {
        const items = ['a', 'b', 'c'];
        const res = paginated(items, { page: 1, pageSize: 10, total: 3 });
        expect(res.data).toEqual(['a', 'b', 'c']);
    });

    test('totalPages 계산: ceil(total / pageSize)', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 25 });
        expect(res.pagination.totalPages).toBe(3);
    });

    test('totalPages 계산: 딱 나누어지는 경우', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 20 });
        expect(res.pagination.totalPages).toBe(2);
    });

    test('hasNext: 다음 페이지 있을 때 true', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 25 });
        expect(res.pagination.hasNext).toBe(true);
    });

    test('hasNext: 마지막 페이지일 때 false', () => {
        const res = paginated([], { page: 3, pageSize: 10, total: 25 });
        expect(res.pagination.hasNext).toBe(false);
    });

    test('hasPrev: 첫 페이지일 때 false', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 25 });
        expect(res.pagination.hasPrev).toBe(false);
    });

    test('hasPrev: 두 번째 이후 페이지일 때 true', () => {
        const res = paginated([], { page: 2, pageSize: 10, total: 25 });
        expect(res.pagination.hasPrev).toBe(true);
    });

    test('pagination에 page, pageSize, total 포함', () => {
        const res = paginated([], { page: 2, pageSize: 5, total: 100 });
        expect(res.pagination.page).toBe(2);
        expect(res.pagination.pageSize).toBe(5);
        expect(res.pagination.total).toBe(100);
    });

    test('meta.timestamp 포함', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 0 });
        expect(res.meta?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('빈 items + total=0 → totalPages=0, hasNext=false, hasPrev=false', () => {
        const res = paginated([], { page: 1, pageSize: 10, total: 0 });
        expect(res.pagination.totalPages).toBe(0);
        expect(res.pagination.hasNext).toBe(false);
        expect(res.pagination.hasPrev).toBe(false);
    });
});

// ===== HTTP 상태 코드 헬퍼 =====

describe('badRequest', () => {
    test('error code = BAD_REQUEST', () => {
        expect(badRequest('잘못된 요청').error.code).toBe(ErrorCodes.BAD_REQUEST);
    });

    test('message 포함', () => {
        expect(badRequest('invalid param').error.message).toBe('invalid param');
    });

    test('details 전달 가능', () => {
        const res = badRequest('err', { field: 'name' });
        expect(res.error.details).toEqual({ field: 'name' });
    });
});

describe('unauthorized', () => {
    test('error code = UNAUTHORIZED', () => {
        expect(unauthorized().error.code).toBe(ErrorCodes.UNAUTHORIZED);
    });

    test('기본 메시지 존재', () => {
        const res = unauthorized();
        expect(res.error.message).toBeTruthy();
    });

    test('커스텀 메시지 가능', () => {
        expect(unauthorized('custom msg').error.message).toBe('custom msg');
    });
});

describe('forbidden', () => {
    test('error code = FORBIDDEN', () => {
        expect(forbidden().error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    test('기본 메시지 존재', () => {
        expect(forbidden().error.message).toBeTruthy();
    });

    test('커스텀 메시지 가능', () => {
        expect(forbidden('접근 거부').error.message).toBe('접근 거부');
    });
});

describe('notFound', () => {
    test('error code = NOT_FOUND', () => {
        expect(notFound().error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    test('기본 리소스명 포함한 메시지', () => {
        const msg = notFound().error.message;
        expect(msg).toContain('리소스');
    });

    test('커스텀 리소스명 포함', () => {
        const msg = notFound('사용자').error.message;
        expect(msg).toContain('사용자');
    });
});

describe('conflict', () => {
    test('error code = CONFLICT', () => {
        expect(conflict('이미 존재합니다').error.code).toBe(ErrorCodes.CONFLICT);
    });

    test('message 포함', () => {
        expect(conflict('duplicate').error.message).toBe('duplicate');
    });
});

describe('validationError', () => {
    test('error code = VALIDATION_ERROR', () => {
        expect(validationError('유효성 오류').error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    test('details 전달 가능', () => {
        const res = validationError('err', ['field is required']);
        expect(res.error.details).toEqual(['field is required']);
    });
});

describe('rateLimited', () => {
    test('error code = RATE_LIMITED', () => {
        expect(rateLimited().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    test('기본 메시지 존재', () => {
        expect(rateLimited().error.message).toBeTruthy();
    });

    test('커스텀 메시지 가능', () => {
        expect(rateLimited('too fast').error.message).toBe('too fast');
    });
});

describe('internalError', () => {
    test('error code = INTERNAL_ERROR', () => {
        expect(internalError().error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });

    test('기본 메시지 존재', () => {
        expect(internalError().error.message).toBeTruthy();
    });

    test('커스텀 메시지 가능', () => {
        expect(internalError('DB 연결 실패').error.message).toBe('DB 연결 실패');
    });
});

describe('serviceUnavailable', () => {
    test('error code = SERVICE_UNAVAILABLE', () => {
        expect(serviceUnavailable().error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
    });

    test('기본 메시지 존재', () => {
        expect(serviceUnavailable().error.message).toBeTruthy();
    });

    test('커스텀 메시지 가능', () => {
        expect(serviceUnavailable('점검 중').error.message).toBe('점검 중');
    });
});

// ===== ErrorCodes 상수 =====

describe('ErrorCodes', () => {
    test('4xx 클라이언트 에러 코드 존재', () => {
        expect(ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
        expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
        expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
        expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
        expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
        expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
        expect(ErrorCodes.RATE_LIMITED).toBe('RATE_LIMITED');
        expect(ErrorCodes.PAYLOAD_TOO_LARGE).toBe('PAYLOAD_TOO_LARGE');
    });

    test('5xx 서버 에러 코드 존재', () => {
        expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
        expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
        expect(ErrorCodes.DATABASE_ERROR).toBe('DATABASE_ERROR');
        expect(ErrorCodes.EXTERNAL_SERVICE_ERROR).toBe('EXTERNAL_SERVICE_ERROR');
    });

    test('도메인 특화 에러 코드 존재', () => {
        expect(ErrorCodes.SESSION_NOT_FOUND).toBe('SESSION_NOT_FOUND');
        expect(ErrorCodes.USER_EXISTS).toBe('USER_EXISTS');
        expect(ErrorCodes.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
        expect(ErrorCodes.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
        expect(ErrorCodes.MODEL_NOT_AVAILABLE).toBe('MODEL_NOT_AVAILABLE');
        expect(ErrorCodes.DOCUMENT_PROCESSING_FAILED).toBe('DOCUMENT_PROCESSING_FAILED');
    });
});
