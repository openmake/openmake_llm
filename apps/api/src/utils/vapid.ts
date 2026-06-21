/**
 * ============================================================
 * VAPID Keys - Web Push 알림용 VAPID 키 관리 유틸리티
 * ============================================================
 *
 * Web Push API(RFC 8292)에 필요한 VAPID(Voluntary Application Server
 * Identification) 키를 관리합니다. 환경 설정에서 키를 로드하거나
 * 새로운 키 쌍을 생성할 수 있습니다.
 *
 * @module utils/vapid
 * @description
 * - 환경 설정에서 VAPID 공개키/비밀키/subject 로드
 * - web-push 라이브러리에 VAPID 인증 정보 자동 설정
 * - 새로운 VAPID 키 쌍 생성
 */

import webPush from 'web-push';
import { getConfig } from '../config/env';

/**
 * 환경 설정에서 VAPID 키를 로드하고 web-push에 설정합니다.
 *
 * 공개키와 비밀키가 모두 존재하면 `webPush.setVapidDetails()`를 호출하여
 * 이후 Push 알림 발송 시 자동으로 VAPID 인증이 적용됩니다.
 *
 * @returns VAPID 공개키, 비밀키, subject(연락처 URL/이메일)
 */
export function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
    const publicKey = getConfig().vapidPublicKey;
    const privateKey = getConfig().vapidPrivateKey;
    const subject = getConfig().vapidSubject;
    
    if (publicKey && privateKey) {
        webPush.setVapidDetails(subject, publicKey, privateKey);
    }
    
    return { publicKey, privateKey, subject };
}

/**
 * 새로운 VAPID 키 쌍을 생성합니다.
 *
 * 초기 설정 시 또는 키 로테이션이 필요할 때 사용합니다.
 * 생성된 키는 환경 변수에 저장하여 사용해야 합니다.
 *
 * @returns 새로 생성된 VAPID 공개키와 비밀키
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
    return webPush.generateVAPIDKeys();
}
