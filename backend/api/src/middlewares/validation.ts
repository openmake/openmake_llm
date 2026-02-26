/**
 * Zod Validation Middleware
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { badRequest } from '../utils/api-response';
import { detectMaliciousPatterns, sanitizeTextInput, hasExcessiveSpecialCharacters } from '../schemas/security.schema';

interface SecurityValidationOptions {
    allowedContentTypes?: string[];
    maxBodySizeBytes?: number;
    sanitizeInput?: boolean;
    detectMaliciousInput?: boolean;
    specialCharacterRatioLimit?: number;
}

export interface FileUploadValidationOptions {
    allowedMimeTypes?: string[];
    allowedExtensions?: string[];
    blockedExtensions?: string[];
    maxFileSizeBytes?: number;
}

const DEFAULT_SECURITY_OPTIONS: Required<SecurityValidationOptions> = {
    allowedContentTypes: ['application/json'],
    maxBodySizeBytes: 1 * 1024 * 1024,
    sanitizeInput: true,
    detectMaliciousInput: false,
    specialCharacterRatioLimit: 0.7,
};

const DEFAULT_FILE_OPTIONS: Required<FileUploadValidationOptions> = {
    allowedMimeTypes: [],   // 빈 배열 = 모든 MIME 타입 허용
    allowedExtensions: [],  // 빈 배열 = 모든 확장자 허용
    blockedExtensions: ['.exe', '.dll', '.bat', '.cmd', '.ps1'],  // 실행 파일만 차단
    maxFileSizeBytes: 300 * 1024 * 1024,  // 300MB
};

function getContentLength(req: Request): number | null {
    const raw = req.headers['content-length'];
    if (typeof raw !== 'string') {
        return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeContentType(contentType: string): string {
    return contentType.split(';')[0].trim().toLowerCase();
}

function extractStringValues(value: unknown, values: string[] = [], depth: number = 0): string[] {
    if (depth > 8) {
        return values;
    }
    if (typeof value === 'string') {
        values.push(value);
        return values;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => extractStringValues(item, values, depth + 1));
        return values;
    }
    if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach((item) => extractStringValues(item, values, depth + 1));
    }
    return values;
}

function sanitizeValue(value: unknown, depth: number = 0): unknown {
    if (depth > 8) {
        return value;
    }
    if (typeof value === 'string') {
        return sanitizeTextInput(value, true);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, depth + 1));
    }
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        Object.entries(source).forEach(([key, item]) => {
            output[key] = sanitizeValue(item, depth + 1);
        });
        return output;
    }
    return value;
}

function findSecurityViolations(payload: unknown, specialCharacterRatioLimit: number): string[] {
    const violations: string[] = [];
    const strings = extractStringValues(payload);

    strings.forEach((input) => {
        const detection = detectMaliciousPatterns(input);
        if (detection.detected) {
            violations.push(...detection.reasons);
        }

        if (hasExcessiveSpecialCharacters(input, specialCharacterRatioLimit)) {
            violations.push('Suspicious special character ratio detected');
        }
    });

    return Array.from(new Set(violations));
}

function createValidationMiddleware<T>(schema: ZodSchema<T>, options: SecurityValidationOptions, mode: 'body' | 'query') {
    const merged = { ...DEFAULT_SECURITY_OPTIONS, ...options };

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const contentType = req.headers['content-type'];
            if (mode === 'body' && contentType && merged.allowedContentTypes.length > 0) {
                const normalized = normalizeContentType(contentType);
                const allowed = merged.allowedContentTypes.some((type) => normalized === type || (type.endsWith('/*') && normalized.startsWith(type.replace('*', ''))));
                if (!allowed) {
                    return res.status(400).json(badRequest('허용되지 않는 Content-Type입니다'));
                }
            }

            const contentLength = getContentLength(req);
            if (mode === 'body' && contentLength !== null && contentLength > merged.maxBodySizeBytes) {
                return res.status(400).json(badRequest(`요청 본문이 너무 큽니다 (최대 ${merged.maxBodySizeBytes} bytes)`));
            }

            const source = mode === 'body' ? req.body : req.query;
            const payload = merged.sanitizeInput ? sanitizeValue(source) : source;

            if (merged.detectMaliciousInput) {
                const violations = findSecurityViolations(payload, merged.specialCharacterRatioLimit);
                if (violations.length > 0) {
                    return res.status(400).json(badRequest(`악성 입력 패턴이 감지되었습니다: ${violations.join(', ')}`));
                }
            }

            const validated = schema.parse(payload);

            if (mode === 'body') {
                req.body = validated;
                return next();
            }

            const currentQuery = req.query as Record<string, unknown>;
            for (const key of Object.keys(currentQuery)) {
                delete currentQuery[key];
            }
            Object.assign(currentQuery, validated);
            return next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.issues.map((e: ZodIssue) =>
                    e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message
                );
                return res.status(400).json(badRequest(messages.join('; ')));
            }
            next(error);
        }
    };
}

function readFileHeader(filePath: string): Buffer {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(16);
        fs.readSync(fd, buffer, 0, 16, 0);
        return buffer;
    } finally {
        fs.closeSync(fd);
    }
}

function isAllowedMagicNumber(header: Buffer, extension: string): boolean {
    const ext = extension.toLowerCase();
    if (ext === '.pdf') {
        return header.slice(0, 5).toString() === '%PDF-';
    }
    if (ext === '.png') {
        return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    }
    if (ext === '.jpg' || ext === '.jpeg') {
        return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    if (ext === '.gif') {
        const signature = header.slice(0, 6).toString();
        return signature === 'GIF87a' || signature === 'GIF89a';
    }
    if (ext === '.webp') {
        return header.slice(0, 4).toString() === 'RIFF' && header.slice(8, 12).toString() === 'WEBP';
    }
    return true;
}

/**
 * Validation middleware factory
 * Returns 400 with formatted error messages on validation failure
 */
export function validate<T>(schema: ZodSchema<T>) {
    return createValidationMiddleware(schema, {}, 'body');
}

/**
 * Validation middleware factory with explicit security options
 */
export function validateWithSecurity<T>(schema: ZodSchema<T>, options: SecurityValidationOptions) {
    return createValidationMiddleware(schema, options, 'body');
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends object>(schema: ZodSchema<T>) {
    return createValidationMiddleware(schema, {
        allowedContentTypes: [],
        maxBodySizeBytes: Number.MAX_SAFE_INTEGER,
    }, 'query');
}

/**
 * Validate query parameters with explicit security options
 */
export function validateQueryWithSecurity<T extends object>(schema: ZodSchema<T>, options: SecurityValidationOptions) {
    return createValidationMiddleware(schema, {
        ...options,
        allowedContentTypes: [],
        maxBodySizeBytes: Number.MAX_SAFE_INTEGER,
    }, 'query');
}

/**
 * Multipart upload 요청 헤더 검사
 */
export function validateUploadContentType(maxBodySizeBytes: number = 100 * 1024 * 1024) {
    return (req: Request, res: Response, next: NextFunction) => {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.toLowerCase().includes('multipart/form-data')) {
            return res.status(400).json(badRequest('파일 업로드는 multipart/form-data만 허용됩니다'));
        }

        const contentLength = getContentLength(req);
        if (contentLength !== null && contentLength > maxBodySizeBytes) {
            return res.status(400).json(badRequest(`업로드 크기가 너무 큽니다 (최대 ${maxBodySizeBytes} bytes)`));
        }

        next();
    };
}

/**
 * Multer 처리 후 파일 보안 검증
 */
export function validateFileUploadSecurity(options: FileUploadValidationOptions = {}) {
    const merged = { ...DEFAULT_FILE_OPTIONS, ...options };
    const blocked = new Set(merged.blockedExtensions.map((ext) => ext.toLowerCase()));
    const allowedExt = new Set(merged.allowedExtensions.map((ext) => ext.toLowerCase()));
    const allowedMime = new Set(merged.allowedMimeTypes.map((mime) => mime.toLowerCase()));

    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.file) {
            return next();
        }

        const originalName = req.file.originalname || '';
        const extension = path.extname(originalName).toLowerCase();
        const mime = (req.file.mimetype || '').toLowerCase();

        if (!originalName || originalName.includes('..') || /[\\/\x00]/.test(originalName)) {
            return res.status(400).json(badRequest('안전하지 않은 파일명입니다'));
        }

        if (blocked.has(extension)) {
            return res.status(400).json(badRequest('허용되지 않는 파일 확장자입니다'));
        }

        // allowedExt가 비어있으면 모든 확장자 허용
        if (allowedExt.size > 0 && !allowedExt.has(extension)) {
            return res.status(400).json(badRequest('지원되지 않는 파일 확장자입니다'));
        }

        // allowedMime가 비어있으면 모든 MIME 타입 허용
        if (allowedMime.size > 0 && !allowedMime.has(mime)) {
            return res.status(400).json(badRequest('지원되지 않는 파일 MIME 타입입니다'));
        }

        if (req.file.size > merged.maxFileSizeBytes) {
            return res.status(400).json(badRequest(`파일 크기가 너무 큽니다 (최대 ${merged.maxFileSizeBytes} bytes)`));
        }

        const nameDetection = detectMaliciousPatterns(originalName);
        if (nameDetection.detected) {
            return res.status(400).json(badRequest('파일명에서 악성 패턴이 감지되었습니다'));
        }

        // magic number 검증: 알려진 타입(.pdf, .png, .jpg, .gif, .webp)에만 적용
        const knownMagicTypes = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
        if (knownMagicTypes.has(extension)) {
            try {
                const header = readFileHeader(req.file.path);
                if (!isAllowedMagicNumber(header, extension)) {
                    return res.status(400).json(badRequest('파일 시그니처 검증에 실패했습니다'));
                }
            } catch {
                return res.status(400).json(badRequest('파일 무결성 검증에 실패했습니다'));
            }
        }

        next();
    };
}
