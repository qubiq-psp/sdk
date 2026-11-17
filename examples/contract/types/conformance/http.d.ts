export interface Answer {
    status: number;
    headers: Headers;
    contentType: string;
    text: string;
    /** The body parsed as JSON; undefined when it is not JSON. */
    json: unknown;
    /** `X-Example-Call-Id`, or null. */
    callId: string | null;
}
export interface CallInit {
    method?: string;
    /** JSON body (serialised here) — or `raw` for bytes as they are. */
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
}
export declare function request(baseUrl: string, path: string, init?: CallInit): Promise<Answer>;
export interface SseEvent {
    event: string;
    id: string | null;
    data: string;
}
/** An open `text/event-stream`: events are collected as they arrive. */
export interface SseStream {
    status: number;
    headers: Headers;
    events: SseEvent[];
    /** Resolves with the first collected (or future) event matching the predicate. */
    waitFor(predicate: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
    close(): void;
}
export declare function openSse(url: string): Promise<SseStream>;
