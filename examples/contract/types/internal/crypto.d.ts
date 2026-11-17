export declare const sha256Hex: (data: string | Uint8Array) => string;
/** SHA-256 of an empty body. */
export declare const EMPTY_BODY_SHA256: string;
export interface ApiSignatureInput {
    secret: string;
    method: string;
    /** Path and query exactly as in the request line. */
    target: string;
    timestamp: string;
    nonce: string;
    body: string | Uint8Array;
}
/** Request signing: six lines joined with `\n`, HMAC-SHA256 with the secret, `v1=` and lowercase hex. */
export declare function signApiRequest(input: ApiSignatureInput): {
    stringToSign: string;
    signature: string;
};
/** Webhook signing: `v1=` + hex HMAC-SHA256 of `${timestamp}.${body}`. */
export declare function signWebhook(secret: string, timestamp: string | number, body: string | Uint8Array): string;
export declare const safeEqual: (a: string, b: string) => boolean;
export interface CheckoutPayload {
    k: string;
    i: string;
    e: number;
    b?: Record<string, string>;
    l?: 'ru' | 'en';
}
export type CheckoutTokenCheck = {
    valid: true;
    payload: CheckoutPayload;
} | {
    valid: false;
    reason: 'format' | 'bad_signature' | 'bad_payload';
    payload?: unknown;
};
/** The widget-token format: `v1.<payload>.<signature>`, signature = base64url HMAC-SHA256(secret, "psp-checkout-v1." + payload). */
export declare function signCheckoutPayload(secret: string, payload: string): string;
/** Verifies a payment-widget token with the secret and checks the payload fields of the platform's widget-link rules. */
export declare function verifyCheckoutToken(token: string, secret: string): CheckoutTokenCheck;
