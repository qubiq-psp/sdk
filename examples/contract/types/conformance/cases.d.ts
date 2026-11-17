export declare const IDS: {
    readonly invoice: "97da92f5-45c0-411b-9ed5-6793b396cd5f";
    readonly operation: "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
    readonly deposit: "e0b38e4d-4bba-4291-9eb5-6c26144f19c3";
    readonly payout: "3b9c1e2a-7d4f-4a8b-9c6d-5e2f1a0b9c8d";
    readonly delivery: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f";
};
export interface ForwardCase {
    operationId: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    /** Contract path with the query, e.g. `/api/invoices?status=active,partially_paid&limit=20`. */
    path: string;
    /** JSON body sent to the backend; undefined — none. */
    body?: unknown;
    /** The platform path (without the query) the backend must call. */
    merchantPath: string;
}
export declare const FORWARD_CASES: ForwardCase[];
