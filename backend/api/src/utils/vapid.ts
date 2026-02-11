import webPush from 'web-push';
import { getConfig } from '../config/env';

export function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
    const publicKey = getConfig().vapidPublicKey;
    const privateKey = getConfig().vapidPrivateKey;
    const subject = getConfig().vapidSubject;
    
    if (publicKey && privateKey) {
        webPush.setVapidDetails(subject, publicKey, privateKey);
    }
    
    return { publicKey, privateKey, subject };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
    return webPush.generateVAPIDKeys();
}
