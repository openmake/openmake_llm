/**
 * validation.test.ts
 * Express Zod Validation Middleware 단위 테스트
 * security.schema는 jest.mock으로 격리
 */

// security.schema mock — 최상단 위치 필수
jest.mock('../schemas/security.schema', () => ({
    detectMaliciousPatterns: jest.fn().mockReturnValue({ detected: false, reasons: [] }),
    sanitizeTextInput: jest.fn((v: string) => v),
    hasExcessiveSpecialCharacters: jest.fn().mockReturnValue(false)
}));

// fs mock — validateFileUploadSecurity 에서 파일 시그니처 검증 시 사용
jest.mock('fs', () => {
    const actual = jest.requireActual<typeof import('fs')>('fs');
    return {
        ...actual,
        openSync: jest.fn().mockReturnValue(1),
        readSync: jest.fn((fd, buffer: Buffer) => {
            // PDF 시그니처: %PDF-
            buffer[0] = 0x25; // %
            buffer[1] = 0x50; // P
            buffer[2] = 0x44; // D
            buffer[3] = 0x46; // F
            buffer[4] = 0x2D; // -
            return 5;
        }),
        closeSync: jest.fn()
    };
});

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
    validate,
    validateWithSecurity,
    validateQuery,
    validateQueryWithSecurity,
    validateUploadContentType,
    validateFileUploadSecurity
} from '../middlewares/validation';
import { detectMaliciousPatterns } from '../schemas/security.schema';
import { FILE_LIMITS } from '../config/constants';

// ============================================================
// 헬퍼 함수
// ============================================================

function makeMockReq(overrides: Partial<{
    headers: Record<string, string>;
    body: unknown;
    query: Record<string, unknown>;
    file: Partial<Express.Multer.File>;
}> = {}): Partial<Request> {
    return {
        headers: { 'content-type': 'application/json', ...overrides.headers },
        body: overrides.body !== undefined ? overrides.body : {},
        query: (overrides.query ?? {}) as Request['query'],
        file: overrides.file as Express.Multer.File | undefined
    };
}

function makeMockRes(): { status: jest.Mock; json: jest.Mock } {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
    return res;
}

// ============================================================
// describe: validate()
// ============================================================

describe('validate()', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    test('유효한 body → next() 호출, req.body 교체', () => {
        const middleware = validate(schema);
        const req = makeMockReq({ body: { name: 'Alice', age: 30 } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ name: 'Alice', age: 30 });
        expect(res.status).not.toHaveBeenCalled();
    });

    test('Zod 유효성 실패 → 400 + 필드 에러 메시지', () => {
        const middleware = validate(schema);
        const req = makeMockReq({ body: { name: 123, age: 'not-a-number' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('필수 필드 누락 → 400', () => {
        const middleware = validate(schema);
        const req = makeMockReq({ body: { name: 'Alice' } }); // age 누락
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Type 불일치 → 400', () => {
        const middleware = validate(schema);
        const req = makeMockReq({
            headers: { 'content-type': 'text/plain' },
            body: { name: 'Alice', age: 30 }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Type 없으면 타입 검사 스킵', () => {
        const middleware = validate(schema);
        const req = makeMockReq({
            headers: {},
            body: { name: 'Bob', age: 25 }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('Content-Length 초과 → 400', () => {
        const middleware = validate(schema);
        const req = makeMockReq({
            headers: {
                'content-type': 'application/json',
                'content-length': String(2 * 1024 * 1024) // 2MB (기본 1MB 초과)
            },
            body: { name: 'Alice', age: 30 }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('에러 메시지에 필드 경로 포함됨', () => {
        const middleware = validate(schema);
        const req = makeMockReq({ body: { name: 123, age: 30 } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: expect.objectContaining({
                message: expect.stringContaining('name')
            })
        }));
    });

    test('application/json;charset=utf-8 → 허용됨 (세미콜론 파싱)', () => {
        const middleware = validate(schema);
        const req = makeMockReq({
            headers: { 'content-type': 'application/json;charset=utf-8' },
            body: { name: 'Alice', age: 30 }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// describe: validateWithSecurity()
// ============================================================

describe('validateWithSecurity()', () => {
    const schema = z.object({ message: z.string() });

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(detectMaliciousPatterns).mockReturnValue({ detected: false, reasons: [] });
    });

    test('detectMaliciousInput=true + 악성 패턴 감지 → 400', () => {
        jest.mocked(detectMaliciousPatterns).mockReturnValue({
            detected: true,
            reasons: ['SQL injection detected']
        });

        const middleware = validateWithSecurity(schema, { detectMaliciousInput: true });
        const req = makeMockReq({ body: { message: "'; DROP TABLE users; --" } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('detectMaliciousInput=false (기본) → 악성 패턴 검사 안 함', () => {
        const middleware = validateWithSecurity(schema, { detectMaliciousInput: false });
        const req = makeMockReq({ body: { message: 'normal input' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        // detectMaliciousPatterns가 호출되지 않아야 함
        expect(detectMaliciousPatterns).not.toHaveBeenCalled();
    });

    test('allowedContentTypes 커스텀 설정 적용', () => {
        const middleware = validateWithSecurity(schema, {
            allowedContentTypes: ['text/plain']
        });
        const req = makeMockReq({
            headers: { 'content-type': 'text/plain' },
            body: { message: 'hi' }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('유효한 body → next() 정상 호출', () => {
        const middleware = validateWithSecurity(schema, {});
        const req = makeMockReq({ body: { message: 'hello' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// describe: validateQuery()
// ============================================================

describe('validateQuery()', () => {
    const schema = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20) });

    test('유효한 query → next() 호출', () => {
        const middleware = validateQuery(schema);
        const req = makeMockReq({ query: { page: '2', limit: '10' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('query 유효성 실패 → 400', () => {
        const strictSchema = z.object({ status: z.enum(['active', 'inactive']) });
        const middleware = validateQuery(strictSchema);
        const req = makeMockReq({ query: { status: 'invalid' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Type 헤더 없어도 query 검증은 통과', () => {
        const middleware = validateQuery(schema);
        const req = makeMockReq({ headers: {}, query: { page: '1' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// describe: validateQueryWithSecurity()
// ============================================================

describe('validateQueryWithSecurity()', () => {
    const schema = z.object({ q: z.string() });

    test('유효한 query + 보안 옵션 → next() 호출', () => {
        const middleware = validateQueryWithSecurity(schema, { detectMaliciousInput: false });
        const req = makeMockReq({ query: { q: 'search term' } });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// describe: validateUploadContentType()
// ============================================================

describe('validateUploadContentType()', () => {
    test('multipart/form-data Content-Type → next() 호출', () => {
        const middleware = validateUploadContentType();
        const req = makeMockReq({
            headers: { 'content-type': 'multipart/form-data; boundary=----boundary' }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('application/json Content-Type → 400', () => {
        const middleware = validateUploadContentType();
        const req = makeMockReq({
            headers: { 'content-type': 'application/json' }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Type 없음 → 400', () => {
        const middleware = validateUploadContentType();
        const req = makeMockReq({ headers: {} });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Length 초과 → 400', () => {
        const maxBytes = 10;
        const middleware = validateUploadContentType(maxBytes);
        const req = makeMockReq({
            headers: {
                'content-type': 'multipart/form-data; boundary=x',
                'content-length': '100'
            }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('Content-Length 이내 → next() 호출', () => {
        const middleware = validateUploadContentType(1000);
        const req = makeMockReq({
            headers: {
                'content-type': 'multipart/form-data; boundary=x',
                'content-length': '500'
            }
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// describe: validateFileUploadSecurity()
// ============================================================

describe('validateFileUploadSecurity()', () => {
    function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
        return {
            fieldname: 'file',
            originalname: 'test.pdf',
            encoding: '7bit',
            mimetype: 'application/pdf',
            size: 1024,
            path: '/tmp/test.pdf',
            destination: '/tmp',
            filename: 'test.pdf',
            buffer: Buffer.from(''),
            stream: null as unknown as import('stream').Readable,
            ...overrides
        };
    }

    test('파일 없으면 next() 호출 (파일 업로드 미사용 경로)', () => {
        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({});
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('허용된 PDF 파일 → next() 호출', () => {
        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({ file: makeFile() });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('차단된 확장자(.exe) → 400', () => {
        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({
            file: makeFile({ originalname: 'malware.exe', mimetype: 'application/octet-stream' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('허용되지 않는 확장자(.zip) → 400', () => {
        const middleware = validateFileUploadSecurity({
            allowedExtensions: [...FILE_LIMITS.ALLOWED_DOCUMENT_EXTENSIONS, ...FILE_LIMITS.ALLOWED_IMAGE_EXTENSIONS]
        });
        const req = makeMockReq({
            file: makeFile({ originalname: 'archive.zip', mimetype: 'application/zip' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('허용되지 않는 MIME 타입 → 400', () => {
        const middleware = validateFileUploadSecurity({
            allowedMimeTypes: [...FILE_LIMITS.ALLOWED_DOCUMENT_MIME_TYPES, ...FILE_LIMITS.ALLOWED_IMAGE_MIME_TYPES]
        });
        const req = makeMockReq({
            file: makeFile({ originalname: 'file.pdf', mimetype: 'text/html' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('파일 크기 초과 → 400', () => {
        const middleware = validateFileUploadSecurity({ maxFileSizeBytes: 100 });
        const req = makeMockReq({
            file: makeFile({ size: 200 })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('경로 순회 파일명(..) → 400', () => {
        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({
            file: makeFile({ originalname: '../etc/passwd' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('파일명에 악성 패턴 감지 → 400', () => {
        jest.mocked(detectMaliciousPatterns).mockReturnValueOnce({
            detected: true,
            reasons: ['malicious filename']
        });
        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({
            file: makeFile({ originalname: 'malicious.pdf' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('커스텀 allowedMimeTypes 적용', () => {
        const middleware = validateFileUploadSecurity({
            allowedMimeTypes: ['text/plain'],
            allowedExtensions: ['.txt'],
            blockedExtensions: []
        });
        const req = makeMockReq({
            file: makeFile({ originalname: 'readme.txt', mimetype: 'text/plain' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        // readSync mock이 txt에 대해 magic number를 검사하지 않으므로 통과해야 함
        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('PNG 파일 → magic number 검증 통과', () => {
        // PNG 시그니처 mock: 0x89 50 4E 47
        const fs = require('fs') as { readSync: jest.Mock };
        fs.readSync.mockImplementationOnce((_fd: number, buffer: Buffer) => {
            buffer[0] = 0x89;
            buffer[1] = 0x50;
            buffer[2] = 0x4E;
            buffer[3] = 0x47;
            return 4;
        });

        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({
            file: makeFile({ originalname: 'image.png', mimetype: 'image/png' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    test('잘못된 PDF magic number → 400', () => {
        const fs = require('fs') as { readSync: jest.Mock };
        fs.readSync.mockImplementationOnce((_fd: number, buffer: Buffer) => {
            // PDF가 아닌 바이트
            buffer[0] = 0x00;
            buffer[1] = 0x00;
            buffer[2] = 0x00;
            buffer[3] = 0x00;
            return 4;
        });

        const middleware = validateFileUploadSecurity();
        const req = makeMockReq({
            file: makeFile({ originalname: 'fake.pdf', mimetype: 'application/pdf' })
        });
        const res = makeMockRes();
        const next = jest.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(400);
    });
});
