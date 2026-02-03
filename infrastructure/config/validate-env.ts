/**
 * #23 개선: 환경변수 유효성 검증
 * 
 * 서버 시작 시 필수 환경변수를 검증하여 설정 오류를 조기 발견합니다.
 * 
 * @example
 * ```typescript
 * import { validateEnvironment } from './validate-env';
 * 
 * // 서버 시작 시 호출
 * const result = validateEnvironment();
 * if (!result.valid) {
 *     console.error('환경 설정 오류:', result.errors);
 *     process.exit(1);
 * }
 * ```
 */

// ===== Validation Result =====
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// ===== Env Variable Definition =====
interface EnvVarDef {
    name: string;
    required: boolean;
    /** Only required in production */
    requiredInProd?: boolean;
    description: string;
    validate?: (value: string) => string | null; // returns error message or null
}

// ===== Validators =====
function isNonEmpty(value: string): string | null {
    return value.trim().length > 0 ? null : 'must not be empty';
}

function isPort(value: string): string | null {
    const port = parseInt(value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        return `must be a valid port number (1-65535), got: ${value}`;
    }
    return null;
}

function isUrl(value: string): string | null {
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return `must be a valid URL starting with http:// or https://, got: ${value}`;
    }
    return null;
}

function isPositiveInt(value: string): string | null {
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) {
        return `must be a positive integer, got: ${value}`;
    }
    return null;
}

function minLength(min: number) {
    return (value: string): string | null => {
        if (value.length < min) {
            return `must be at least ${min} characters long (got ${value.length})`;
        }
        return null;
    };
}

function isLogLevel(value: string): string | null {
    const valid = ['debug', 'info', 'warn', 'error'];
    if (!valid.includes(value.toLowerCase())) {
        return `must be one of: ${valid.join(', ')}, got: ${value}`;
    }
    return null;
}

// ===== Environment Variable Definitions =====
const ENV_VARS: EnvVarDef[] = [
    // Server & Security
    {
        name: 'PORT',
        required: false,
        description: 'Server port',
        validate: isPort
    },
    {
        name: 'JWT_SECRET',
        required: false,
        requiredInProd: true,
        description: 'JWT signing secret (min 32 chars)',
        validate: minLength(32)
    },
    {
        name: 'SESSION_SECRET',
        required: false,
        requiredInProd: true,
        description: 'Session secret for cookie signing',
        validate: minLength(16)
    },
    {
        name: 'ADMIN_PASSWORD',
        required: false,
        requiredInProd: true,
        description: 'Admin password for management access',
        validate: minLength(8)
    },
    {
        name: 'NODE_ENV',
        required: false,
        description: 'Node environment',
        validate: (v) => {
            const valid = ['development', 'production', 'test'];
            return valid.includes(v) ? null : `must be one of: ${valid.join(', ')}`;
        }
    },

    // Ollama / LLM
    {
        name: 'OLLAMA_BASE_URL',
        required: false,
        description: 'Ollama API base URL',
        validate: isUrl
    },
    {
        name: 'OLLAMA_DEFAULT_MODEL',
        required: false,
        description: 'Default LLM model name',
        validate: isNonEmpty
    },
    {
        name: 'OLLAMA_TIMEOUT',
        required: false,
        description: 'Ollama API timeout (ms)',
        validate: isPositiveInt
    },

    // Google OAuth (prod-required)
    {
        name: 'GOOGLE_CLIENT_ID',
        required: false,
        requiredInProd: true,
        description: 'Google OAuth 2.0 Client ID',
        validate: isNonEmpty
    },
    {
        name: 'GOOGLE_CLIENT_SECRET',
        required: false,
        requiredInProd: true,
        description: 'Google OAuth 2.0 Client Secret',
        validate: isNonEmpty
    },

    // Database
    {
        name: 'DB_PATH',
        required: false,
        description: 'SQLite database file path',
        validate: isNonEmpty
    },

    // Logging
    {
        name: 'LOG_LEVEL',
        required: false,
        description: 'Application log level',
        validate: isLogLevel
    },

    // Rate Limiting
    {
        name: 'RATE_LIMIT_WINDOW_MS',
        required: false,
        description: 'Rate limit window in milliseconds',
        validate: isPositiveInt
    },
    {
        name: 'RATE_LIMIT_MAX',
        required: false,
        description: 'Max requests per rate limit window',
        validate: isPositiveInt
    }
];

// ===== Main Validation Function =====

/**
 * 환경변수 유효성 검증
 * 
 * @param env - process.env 또는 커스텀 env 객체 (테스트용)
 * @returns ValidationResult - valid, errors, warnings 포함
 */
export function validateEnvironment(
    env: Record<string, string | undefined> = process.env
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const isProd = env.NODE_ENV === 'production';

    for (const varDef of ENV_VARS) {
        const value = env[varDef.name];

        // Check if required
        if (!value) {
            if (varDef.required) {
                errors.push(`❌ ${varDef.name} is required (${varDef.description})`);
            } else if (varDef.requiredInProd && isProd) {
                errors.push(`❌ ${varDef.name} is required in production (${varDef.description})`);
            } else if (varDef.requiredInProd) {
                warnings.push(`⚠️ ${varDef.name} is recommended (${varDef.description})`);
            }
            continue;
        }

        // Run validator if value exists
        if (varDef.validate) {
            const validationError = varDef.validate(value);
            if (validationError) {
                errors.push(`❌ ${varDef.name}: ${validationError}`);
            }
        }
    }

    // Cross-field validations
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
        errors.push('❌ GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set');
    }
    if (env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_CLIENT_ID) {
        errors.push('❌ GOOGLE_CLIENT_ID is required when GOOGLE_CLIENT_SECRET is set');
    }

    // Token encryption key check (from #1 improvement)
    if (isProd && !env.TOKEN_ENCRYPTION_KEY) {
        warnings.push('⚠️ TOKEN_ENCRYPTION_KEY not set — encrypted tokens will use fallback key');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * 환경변수 검증 후 결과 출력 (서버 시작 시 사용)
 * 
 * @returns true if validation passed, false if critical errors found
 */
export function validateAndReport(
    env: Record<string, string | undefined> = process.env
): boolean {
    const result = validateEnvironment(env);

    if (result.warnings.length > 0) {
        console.warn('[Config] ⚠️ 환경변수 경고:');
        result.warnings.forEach(w => console.warn(`  ${w}`));
    }

    if (!result.valid) {
        console.error('[Config] ❌ 환경변수 검증 실패:');
        result.errors.forEach(e => console.error(`  ${e}`));
        console.error('[Config] .env.example을 참고하여 필수 환경변수를 설정하세요.');
        return false;
    }

    console.log('[Config] ✅ 환경변수 검증 통과');
    return true;
}
