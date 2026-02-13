declare module 'nodemailer' {
    export interface Transporter {
        sendMail(mailOptions: Record<string, unknown>): Promise<unknown>;
    }

    export function createTransport(options: Record<string, unknown>): Transporter;

    const nodemailer: {
        createTransport: typeof createTransport;
    };

    export default nodemailer;
}
