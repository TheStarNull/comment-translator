/**
 * Shared timeout utilities for every network call in this project.
 *
 * Why this exists
 * ---------------
 * Node's built-in `fetch` (undici) has no overall request deadline. A server
 * that accepts the TCP connection and then simply never replies will hang the
 * process effectively forever — undici's own headers/body timeouts default to
 * 300s, which for a CLI is indistinguishable from "no timeout". Every backend
 * therefore needs an explicit AbortController-based deadline.
 *
 * Before this module existed the coverage was inconsistent:
 *   - LibreTranslate:            30s   (inline AbortController)
 *   - LLM client (polish):       60s   (inline AbortController)
 *   - Google Translate API:      NONE  ← could hang forever
 *   - Google OAuth token swap:   NONE  ← could hang forever
 *   - DeepL:                     only the SDK default (10s), not controlled by us
 *
 * `fetchWithTimeout` centralises the pattern so a stalled endpoint always fails
 * fast with a clear, actionable message instead of freezing the run.
 */

/** Default network deadline for translation API calls (30 seconds). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thrown when a request exceeds its deadline. Distinct from a user/caller
 * abort (e.g. Ctrl-C) and from a socket error, so callers can decide whether
 * the failure is worth retrying.
 */
export class TimeoutError extends Error {
  /** Node-style code, so generic error handling recognises it. */
  readonly code = 'ETIMEDOUT';
  /** Explicit marker — cheap and unambiguous for `isTimeoutError`. */
  readonly timedOut = true;

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * True only for a *deadline* failure.
 *
 * Deliberately NOT true for a bare `AbortError`: that is what a caller-issued
 * cancellation (external signal, Ctrl-C) surfaces as, and retrying a run the
 * user just cancelled would be wrong. `fetchWithTimeout` converts its own
 * timer-driven abort into a `TimeoutError`, so this stays unambiguous.
 */
export function isTimeoutError(e: unknown): boolean {
  const err = e as any;
  if (!err || typeof err !== 'object') return false;
  if (err.timedOut === true) return true;
  if (err.name === 'TimeoutError') return true;
  return err.code === 'ETIMEDOUT';
}

export interface FetchWithTimeoutInit extends RequestInit {
  /** Optional caller signal; combined with the internal deadline. */
  signal?: AbortSignal | null;
}

/**
 * `fetch` with a hard deadline.
 *
 * @param url       Request URL.
 * @param init      Standard fetch init. An existing `signal` is honoured and
 *                  combined with the timeout (whichever fires first wins).
 * @param timeoutMs Deadline in ms. Non-finite or <= 0 disables the deadline
 *                  (only the caller's signal can abort).
 * @param label     Human-readable name used in the timeout message.
 */
export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  label = 'HTTP request'
): Promise<Response> {
  const controller = new AbortController();
  const useDeadline = Number.isFinite(timeoutMs) && timeoutMs > 0;

  let timedOut = false;
  const timer = useDeadline
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  // Don't let a pending deadline keep the process alive on its own.
  if (timer && typeof timer.unref === 'function') timer.unref();

  // Chain an external signal (if any) into our controller so callers can still
  // cancel — e.g. Ctrl-C — without being misreported as a timeout.
  const external = init.signal ?? undefined;
  const onExternalAbort = () => controller.abort((external as any)?.reason);
  if (external) {
    if (external.aborted) controller.abort((external as any).reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal } as RequestInit);
  } catch (e) {
    // Distinguish "we gave up waiting" from "the caller cancelled" / real errors.
    if (timedOut) throw new TimeoutError(label, timeoutMs);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}
