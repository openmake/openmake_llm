import { z } from 'zod';

export interface SecureTextOptions {
    minLength?: number;
    maxLength?: number;
    allowNewLines?: boolean;
    fieldName?: string;
    allowHtmlLikeContent?: boolean;
    specialCharacterRatioLimit?: number;
    detectMaliciousPatterns?: boolean;
}

export interface MaliciousDetectionResult {
    detected: boolean;
    reasons: string[];
}

const SQL_INJECTION_PATTERNS: readonly RegExp[] = [
    /(?:'|"|`)?\s*(?:or|and)\s+(?:'|"|`)?\d+(?:'|"|`)?\s*=\s*(?:'|"|`)?\d+/i,
    /union\s+select/i,
    /(?:drop|truncate|alter|create)\s+table/i,
    /insert\s+into\s+\w+\s*\(/i,
    /delete\s+from\s+\w+/i,
    /\bexec(?:ute)?\b\s*\(/i,
    /information_schema/i,
    /\bpg_catalog\b/i,
];

const XSS_PATTERNS: readonly RegExp[] = [
    /<\s*script\b/i,
    /<\s*iframe\b/i,
    /<\s*img\b[^>]*on\w+\s*=/i,
    /<\s*svg\b[^>]*on\w+\s*=/i,
    /on(?:error|load|click|focus|mouseover)\s*=/i,
    /javascript\s*:/i,
    /data\s*:\s*text\/html/i,
    /document\.(?:cookie|location|write)/i,
    /window\.location/i,
];

const COMMAND_INJECTION_PATTERNS: readonly RegExp[] = [
    /(?:^|\s)(?:;|\|\||&&|\|)\s*(?:cat|ls|bash|sh|curl|wget|nc|python|node)\b/i,
    /\$\((?:.|\n){0,80}\)/i,
    /`(?:.|\n){0,80}`/i,
    /(?:^|\s)(?:rm|chmod|chown|mkfs|dd)\s+-/i,
    /(?:\.\.\/){2,}/,
];

const ENCODING_ATTACK_PATTERNS: readonly RegExp[] = [
    /%(?:00|0a|0d|3c|3e|22|27|2f|5c)/i,
    /\\x[0-9a-f]{2}/i,
    /\\u00[0-9a-f]{2}/i,
    /&#x?[0-9a-f]+;/i,
];

function stripControlChars(value: string): string {
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function sanitizeTextInput(value: string, allowNewLines: boolean = true): string {
    const normalized = value.normalize('NFKC');
    const withoutControlChars = stripControlChars(normalized);
    const collapsed = allowNewLines
        ? withoutControlChars.replace(/[^\S\n]+/g, ' ').replace(/\n{4,}/g, '\n\n\n')
        : withoutControlChars.replace(/\s+/g, ' ');
    return collapsed.trim();
}

function safeDecodeURIComponent(input: string): string {
    try {
        return decodeURIComponent(input);
    } catch {
        return input;
    }
}

export function detectMaliciousPatterns(input: string): MaliciousDetectionResult {
    const reasons: string[] = [];
    const decoded = safeDecodeURIComponent(input);
    const normalized = decoded.normalize('NFKC');

    if (SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
        reasons.push('Potential SQL injection pattern detected');
    }
    if (XSS_PATTERNS.some((pattern) => pattern.test(normalized))) {
        reasons.push('Potential XSS payload detected');
    }
    if (COMMAND_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
        reasons.push('Potential command injection pattern detected');
    }
    if (ENCODING_ATTACK_PATTERNS.some((pattern) => pattern.test(input))) {
        reasons.push('Suspicious encoded payload pattern detected');
    }

    return { detected: reasons.length > 0, reasons };
}

export function hasExcessiveSpecialCharacters(input: string, ratioLimit: number = 0.65): boolean {
    const visible = input.replace(/\s/g, '');
    if (visible.length < 12) {
        return false;
    }

    const specialMatches = visible.match(/[^\p{L}\p{N}]/gu);
    const specialCount = specialMatches ? specialMatches.length : 0;
    return (specialCount / visible.length) > ratioLimit;
}

export function secureTextSchema(options: SecureTextOptions = {}) {
    const minLength = options.minLength ?? 0;
    const maxLength = options.maxLength ?? 10000;
    const allowNewLines = options.allowNewLines ?? true;
    const fieldName = options.fieldName ?? '입력값';
    const allowHtmlLikeContent = options.allowHtmlLikeContent ?? false;
    const specialCharacterRatioLimit = options.specialCharacterRatioLimit ?? 0.65;
    const detectPatterns = options.detectMaliciousPatterns ?? true;

    return z.string()
        .min(minLength)
        .max(maxLength)
        .transform((value) => sanitizeTextInput(value, allowNewLines))
        .superRefine((value, ctx) => {
            if (detectPatterns) {
                const detection = detectMaliciousPatterns(value);

                if (detection.detected) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `${fieldName}에 허용되지 않는 보안 패턴이 감지되었습니다`,
                    });
                }
            }

            if (!allowHtmlLikeContent && /<[^>]+>/.test(value)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${fieldName}에 HTML 태그 형태의 입력은 허용되지 않습니다`,
                });
            }

            if (hasExcessiveSpecialCharacters(value, specialCharacterRatioLimit)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${fieldName}에 비정상적으로 많은 특수문자가 포함되어 있습니다`,
                });
            }
        });
}

export function secureOptionalTextSchema(options: SecureTextOptions = {}) {
    return secureTextSchema(options).optional();
}
