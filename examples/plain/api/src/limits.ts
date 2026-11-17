// How much of a request body the backend reads. A larger body is `413 example_payload_too_large`, refused while it
// arrives (examples/contract/README.md, "Errors").

/** `/api/*`: up to 1 MB reaches the platform, which itself refuses more than 64 KB (`413 payload_too_large`). */
export const API_BODY_LIMIT = 1024 * 1024;

/**
 * `POST /webhooks/psp`: the platform sends up to 64 KB, so the receiver reads no more. This path is open to anyone
 * (no basic auth in front of it).
 */
export const WEBHOOK_BODY_LIMIT = 64 * 1024;

/** The limit of the path of a request. */
export const bodyLimitOf = (url: string): number =>
  url.startsWith('/webhooks/') ? WEBHOOK_BODY_LIMIT : API_BODY_LIMIT;
