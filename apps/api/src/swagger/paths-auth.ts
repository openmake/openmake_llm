/**
 * OpenAPI Paths: Auth — 로그인/로그아웃/me/refresh/OAuth/CSRF
 *
 * @module swagger/paths-auth
 * @description
 * `controllers/auth.controller.ts`·`auth-oauth.controller.ts` 표면 (마운트 `/api/auth`).
 * 응답은 `utils/api-response.ts` envelope (`{ success, data, meta }`) — schemas-core 참조.
 *
 * ⚠️ CSRF 클라이언트 규약 (비브라우저 클라이언트 필수):
 * `/api/*` 의 mutating 요청은 Double-Submit CSRF 검증 대상 (기본 enforce).
 * Bearer 헤더 요청은 면제되므로 인증 후에는 추가 작업이 없다. 단 **사전 인증
 * POST(login·register·refresh)** 는 `GET /api/csrf-token` 으로 부트스트랩한 뒤
 * 발급 쿠키 + `X-CSRF-Token` 헤더를 함께 보내야 한다 (`middlewares/csrf-protection.ts`).
 */
import { envelope, failureResponse } from './schemas-core';

export const authPaths = {
    '/api/auth/login': {
        post: {
            tags: ['Auth'],
            summary: '로그인',
            description: '이메일과 비밀번호로 로그인합니다. access token 은 응답 body 와 HttpOnly 쿠키 양쪽에 발급됩니다 (refresh token 은 쿠키 전용 — 모바일 body 모드는 축 2 도입 예정). 사전 인증 POST 이므로 CSRF 부트스트랩 필요 (모듈 설명 참고).',
            security: [],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['email', 'password'],
                            properties: {
                                email: { type: 'string', format: 'email' },
                                password: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '로그인 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['success'],
                                properties: {
                                    success: { type: 'boolean', enum: [true] },
                                    token: { type: 'string', description: 'JWT access token' },
                                    user: { $ref: '#/components/schemas/PublicUser' }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('인증 실패 (이메일/비밀번호 불일치)'),
                '403': failureResponse('CSRF 검증 실패 (CSRF_TOKEN_MISMATCH)')
            }
        }
    },
    '/api/auth/register': {
        post: {
            tags: ['Auth'],
            summary: '회원가입',
            description: '새로운 사용자 계정을 생성합니다. 사전 인증 POST 이므로 CSRF 부트스트랩 필요.',
            security: [],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['email', 'password'],
                            properties: {
                                email: { type: 'string', format: 'email' },
                                password: { type: 'string', description: '비밀번호 (8자 이상, 대소문자/숫자/특수문자 포함)' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: '회원가입 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['success'],
                                properties: {
                                    success: { type: 'boolean', enum: [true] },
                                    user: { $ref: '#/components/schemas/PublicUser' }
                                }
                            })
                        }
                    }
                },
                '400': failureResponse('유효성 검사 실패'),
                '409': failureResponse('이미 존재하는 이메일')
            }
        }
    },
    '/api/auth/logout': {
        post: {
            tags: ['Auth'],
            summary: '로그아웃',
            description: '현재 access token (Bearer 헤더 + 쿠키) 을 블랙리스트에 추가하고 인증 쿠키를 제거합니다.',
            security: [{ bearerAuth: [] }],
            responses: {
                '200': {
                    description: '로그아웃 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['message'],
                                properties: { message: { type: 'string' } }
                            })
                        }
                    }
                },
                '401': failureResponse('인증 필요')
            }
        }
    },
    '/api/auth/me': {
        get: {
            tags: ['Auth'],
            summary: '현재 사용자 정보',
            description: '인증 상태 확인 규약: 토큰이 아예 없으면(순수 게스트) 200 + `{user: null}`, 토큰이 있었으나 만료/무효면 401 (클라이언트는 refresh 흐름으로 세션 복구).',
            security: [{ bearerAuth: [] }, {}],
            responses: {
                '200': {
                    description: '성공 (미인증 게스트는 user=null)',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['user'],
                                properties: {
                                    user: {
                                        oneOf: [
                                            { $ref: '#/components/schemas/PublicUser' },
                                            { type: 'object', nullable: true, enum: [null] }
                                        ],
                                        nullable: true
                                    }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('토큰 만료/무효 — refresh 필요')
            }
        }
    },
    '/api/auth/refresh': {
        post: {
            tags: ['Auth'],
            summary: '토큰 갱신 (rotation)',
            description: 'refresh token 쿠키(`path=/api/auth/refresh`)로 새 access token 을 발급합니다. 구 refresh token 은 블랙리스트 처리되고 새 refresh token 이 쿠키로 회전 발급됩니다. 사전 인증 POST 이므로 CSRF 부트스트랩 필요. (모바일 body 모드 — body.refreshToken 수용·반환 — 는 축 2 도입 후 본 계약에 반영.)',
            security: [],
            responses: {
                '200': {
                    description: '갱신 성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['token', 'user'],
                                properties: {
                                    token: { type: 'string', description: '새 JWT access token' },
                                    user: { $ref: '#/components/schemas/PublicUser' }
                                }
                            })
                        }
                    }
                },
                '401': failureResponse('refresh token 없음/만료/무효 — 재로그인 필요'),
                '403': failureResponse('CSRF 검증 실패 (CSRF_TOKEN_MISMATCH)')
            }
        }
    },
    '/api/auth/providers': {
        get: {
            tags: ['Auth'],
            summary: 'OAuth 프로바이더 목록',
            description: '서버에 설정된 OAuth 프로바이더 id 목록을 반환합니다.',
            security: [],
            responses: {
                '200': {
                    description: '성공',
                    content: {
                        'application/json': {
                            schema: envelope({
                                type: 'object',
                                required: ['providers'],
                                properties: {
                                    providers: {
                                        type: 'array',
                                        items: { type: 'string', enum: ['google', 'github', 'kakao'] }
                                    }
                                }
                            })
                        }
                    }
                }
            }
        }
    },
    '/api/auth/login/google': {
        get: {
            tags: ['Auth'],
            summary: 'Google OAuth 시작',
            description: 'Google 인가 페이지로 302 리다이렉트합니다. 완료 시 서버 콜백(`/api/auth/callback/google` — 서버↔IdP 표면이라 본 계약 비노출)이 인증 쿠키를 설정하고 웹으로 리다이렉트합니다. (모바일 `?client=ios` + exchange code 흐름은 축 2 도입 후 반영.)',
            security: [],
            responses: {
                '302': { description: 'Google 인가 URL 로 리다이렉트' },
                '500': failureResponse('OAuth 미설정 (client id 없음)')
            }
        }
    },
    '/api/csrf-token': {
        get: {
            tags: ['Auth'],
            summary: 'CSRF 토큰 발급 (Double-Submit 부트스트랩)',
            description: 'non-HttpOnly 쿠키와 응답 body 로 CSRF 토큰을 발급합니다. 이후 사전 인증 mutating 요청에 쿠키 + `X-CSRF-Token` 헤더를 함께 보냅니다. ⚠️ 이 응답은 envelope 미적용 raw JSON 입니다.',
            security: [],
            responses: {
                '200': {
                    description: '발급 성공 (envelope 미적용)',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['token'],
                                properties: { token: { type: 'string' } }
                            }
                        }
                    }
                }
            }
        }
    }
};
