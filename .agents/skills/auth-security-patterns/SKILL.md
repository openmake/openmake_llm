---
name: auth-security-patterns
description: OpenMake LLM의 인증 및 보안 패턴. JWT Access/Refresh Token, OAuth 2.0 (Google/GitHub), API Key HMAC-SHA-256, Scope 기반 접근 제어, Rate Limiting, CORS. auth/, middlewares/ 디렉토리 작업 시 필수. Use when working with authentication, authorization, API keys, OAuth, security middleware, or access control.
---

# Auth & Security Patterns — OpenMake LLM

인증, 인가, API 보안의 아키텍처와 패턴.

## 디렉토리 구조

```
auth/
├── index.ts           # JWT 생성/검증, 토큰 블랙리스트, 쿠키 설정
├── middleware.ts       # requireAuth, optionalAuth, requireAdmin 미들웨어
├── oauth-provider.ts  # Google/GitHub OAuth 2.0 프로바이더
├── api-key-utils.ts   # API Key 생성/해싱 (HMAC-SHA-256)
├── scope-middleware.ts # Scope 기반 접근 제어
└── types.ts           # JWTPayload, AuthUser 타입

middlewares/
├── api-key-auth.ts      # API Key 인증 미들웨어
├── api-key-limiter.ts   # TPM Rate Limiting
├── chat-rate-limiter.ts # 채팅 전용 Rate Limiting
├── rate-limit-headers.ts # OpenAI 호환 Rate Limit 헤더
├── request-id.ts        # Request ID 추적
└── validation.ts        # Zod 스키마 검증
```

## ⚠️ 핵심 규칙

**`auth/` 디렉토리 코드는 기존 동작 변경 금지.** Additive 변경만 허용.

## JWT 토큰 시스템

### Access Token (15분)
```typescript
function generateToken(user: PublicUser): string {
    const payload: JWTPayload = { userId: user.id, email: user.email, role: user.role };
    const jti = crypto.randomBytes(16).toString('hex');  // 블랙리스트용
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m', jwtid: jti });
}
```

### Refresh Token (7일)
```typescript
function generateRefreshToken(user: PublicUser): string {
    const payload = { userId, email, role, type: 'refresh' as const };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d', jwtid: jti });
}
```

### 토큰 검증 (블랙리스트 체크 포함)
```typescript
async function verifyToken(token: string): Promise<JWTPayload | null> {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.jti) {
        const blacklist = getTokenBlacklist();
        if (await blacklist.isBlacklisted(decoded.jti)) return null;
    }
    return decoded;
}
```

### 쿠키 설정
```typescript
function setTokenCookie(res: Response, token: string): void {
    res.cookie('auth_token', token, {
        httpOnly: true, secure: production, sameSite: 'strict',
        maxAge: 15 * 60 * 1000  // 15분
    });
}
```

## 인증 미들웨어

### optionalAuth — 게스트 허용
```typescript
// Cookie (httpOnly) → Authorization 헤더 순으로 토큰 추출
const token = req.cookies?.auth_token || extractToken(authHeader);
if (token) { req.user = await verifyAndGetUser(token); }
next();  // 토큰 없어도 통과
```

### requireAuth — 인증 필수
```typescript
// 토큰 없거나 유효하지 않으면 401 반환
if (!token || !payload) { return res.status(401).json({ error: 'Unauthorized' }); }
```

### Express Request 타입 확장
```typescript
declare global {
    namespace Express {
        interface Request {
            user?: PublicUser | AuthUser;
            token?: string;
            authMethod?: 'jwt' | 'api-key';
            apiKeyId?: string;
            apiKeyRecord?: UserApiKey;
            requestId?: string;
        }
    }
}
```

## OAuth 2.0 (Google + GitHub)

### 프로바이더 설정
```typescript
const PROVIDER_CONFIGS = {
    google: { authorizationUrl: '...', tokenUrl: '...', userInfoUrl: '...', scopes: ['openid', 'email', 'profile'] },
    github: { authorizationUrl: '...', tokenUrl: '...', userInfoUrl: '...', scopes: ['read:user', 'user:email'] }
};
```

### OAuth 플로우
1. `/api/auth/{provider}` → CSRF nonce 생성 + 리다이렉트
2. 프로바이더 인증 완료 → `/api/auth/callback/{provider}`
3. access_token으로 userInfo 조회
4. 사용자 생성/갱신 → JWT 발급 → Cookie 설정 → 프론트엔드 리다이렉트

### CSRF 방지
```typescript
interface OAuthState { nonce: string; provider: string; returnUrl?: string; createdAt: Date; }
// state 파라미터로 nonce 전달, 콜백에서 검증
```

## API Key 시스템

### Key 생성 (HMAC-SHA-256)
```typescript
// api-key-utils.ts
function generateApiKey(): { key: string; hash: string } {
    const key = `omk_live_sk_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHmac('sha256', API_KEY_SECRET).update(key).digest('hex');
    return { key, hash };  // key는 사용자에게, hash만 DB 저장
}
```

### Key 인증 미들웨어
```typescript
// X-API-Key 헤더에서 추출 → HMAC 해시 → DB 조회 → req.authMethod = 'api-key'
```

## Rate Limiting

| 미들웨어 | 대상 | 기본값 |
|----------|------|--------|
| `chat-rate-limiter.ts` | 채팅 API | 분당 20회 |
| `api-key-limiter.ts` | API Key | TPM (토큰/분) 기반 |
| `rate-limit-headers.ts` | 전체 | OpenAI 호환 헤더 |

## Scope 기반 접근 제어

```typescript
// scope-middleware.ts
function requireScope(scope: string) {
    return (req, res, next) => {
        if (!req.apiKeyRecord?.scopes?.includes(scope)) {
            return res.status(403).json({ error: 'Insufficient scope' });
        }
        next();
    };
}
```

## 보안 체크리스트

새 엔드포인트 추가 시:
- [ ] 적절한 인증 미들웨어 적용 (requireAuth / optionalAuth)
- [ ] API Key 접근 허용 여부 결정
- [ ] Rate Limiting 적용
- [ ] 입력 검증 (Zod 스키마)
- [ ] CORS 화이트리스트 확인
- [ ] 에러 응답에 민감 정보 미포함
- [ ] 기존 auth 테스트 통과 (auth.test.ts 275줄, auth-middleware.test.ts 325줄)
