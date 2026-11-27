/**
 * 요청 역할 판정 포트 — add-on 라우트가 `data/user-manager` 를 직접 import 하지 않고 관리자 여부를 묻는 문.
 * add-on 게이트가 `optionalAuth` 로 `req.user` 를 채운 뒤에 쓴다(역할 문자열만 본다).
 *
 * @module runtime-ports/request-auth
 */
export { isAdminRole } from '../data/user-manager';
