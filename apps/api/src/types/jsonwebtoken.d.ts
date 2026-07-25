declare module 'jsonwebtoken' {
    export type Secret = string;

    export type Algorithm =
        | 'HS256' | 'HS384' | 'HS512'
        | 'RS256' | 'RS384' | 'RS512'
        | 'ES256' | 'ES384' | 'ES512'
        | 'PS256' | 'PS384' | 'PS512'
        | 'none';

    export interface SignOptions {
        expiresIn?: string | number;
        jwtid?: string;
        algorithm?: Algorithm;
    }

    export interface VerifyOptions {
        algorithms?: Algorithm[];
    }

    export function sign(
        payload: string | object | Buffer,
        secretOrPrivateKey: Secret,
        options?: SignOptions
    ): string;

    export function verify(token: string, secretOrPublicKey: Secret, options?: VerifyOptions): unknown;

    export function decode(token: string): null | string | Record<string, unknown>;
}
