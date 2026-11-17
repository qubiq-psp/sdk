type Json = Record<string, unknown>;
export declare const contractDocument: Json;
export declare const merchantApiDocument: Json;
export interface OperationInfo {
    operationId: string;
    method: string;
    /** Path template, e.g. `/api/v1/invoices/{invoiceId}`. */
    path: string;
    /** JSON pointer of the operation in its document. */
    pointer: string;
    op: Json;
}
export declare const contractOperations: OperationInfo[];
export declare const merchantOperations: OperationInfo[];
export declare const contractOperation: (operationId: string) => OperationInfo;
export declare const merchantOperation: (operationId: string) => OperationInfo;
/** The 27 Merchant API operationIds. */
export declare const MERCHANT_OPERATION_IDS: string[];
/** Resolves a local `$ref` of the given document. */
export declare function resolveLocal(doc: Json, ref: string): Json;
/** Names of the query parameters of a Merchant API operation. */
export declare function merchantQueryNames(operationId: string): Set<string>;
/** The JSON schema of the request body of a Merchant API operation, or null. */
export declare function merchantBodySchema(operationId: string): Json | null;
/** The documented answers of a Merchant API operation: status → media type → example (or examples by name). */
export declare function merchantResponse(operationId: string, status: string): Json | undefined;
export declare function successStatuses(operationId: string): number[];
/** The example of a 2xx answer (a deep copy). */
export declare function merchantExample(operationId: string, status: number, media?: string): unknown;
/** A documented error example `{errorCode, errorMessage, details}` of the operation, if there is one for the code. */
export declare function merchantErrorExample(operationId: string, errorCode: string): {
    status: number;
    body: Json;
} | null;
/** Validates a value against the schema at a JSON pointer of the contract; returns the errors (empty — valid). */
export declare function validateAt(pointer: string, value: unknown): string[];
/** Validates a value against `#/components/schemas/<name>` of the contract. */
export declare const validateSchema: (name: string, value: unknown) => string[];
/** Validates a value against a schema of merchant-api.v1.json (`#/components/schemas/<name>` or any pointer). */
export declare function validateMerchantApi(pointer: string, value: unknown): string[];
/**
 * Validates the body of a contract response: the schema of `status` (or its class `4XX`/`5XX`, or `default`) and
 * the media type of the contract operation. Returns the errors; a response the contract does not describe is an error.
 */
export declare function validateResponse(operationId: string, status: number, contentType: string, body: unknown): string[];
export {};
