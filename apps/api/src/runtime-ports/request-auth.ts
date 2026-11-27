/**
 * 요청 역할 판정·인증 포트 — add-on 라우트가 `data/user-manager`·`auth`·`middlewares` 를 직접 import 하지 않고 관리자 여부를 묻거나 인증·검증 미들웨어를 거는 문.
 * add-on 게이트가 `optionalAuth` 로 `req.user` 를 채운 뒤에 쓴다(역할 문자열만 본다).
 *
 * @module runtime-ports/request-auth
 */
export { isAdminRole } from '../data/user-manager';

// add-on 라우트의 인증·요청 검증 — `auth`·`middlewares` 를 직접 import 하지 않는 문(§8-2, Base 라우트와 같은 미들웨어)
export { requireAuth } from '../auth/middleware';
export { validate } from '../middlewares/validation';
