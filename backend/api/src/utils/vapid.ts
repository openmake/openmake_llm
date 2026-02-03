import webPush from 'web-push';

export function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
    const publicKey = process.env.VAPID_PUBLIC_KEY || '';
    const privateKey = process.env.VAPID_PRIVATE_KEY || '';
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@openmake.ai';
    
    if (publicKey && privateKey) {
        webPush.setVapidDetails(subject, publicKey, privateKey);
    }
    
    return { publicKey, privateKey, subject };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
    return webPush.generateVAPIDKeys();
}
