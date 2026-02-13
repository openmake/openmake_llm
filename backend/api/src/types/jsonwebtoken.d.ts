declare module 'jsonwebtoken' {
    export type Secret = string;

    export interface SignOptions {
        expiresIn?: string | number;
        jwtid?: string;
    }

    export function sign(
        payload: string | object | Buffer,
        secretOrPrivateKey: Secret,
        options?: SignOptions
    ): string;

    export function verify(token: string, secretOrPublicKey: Secret): unknown;

    export function decode(token: string): null | string | Record<string, unknown>;
}
