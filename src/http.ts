/**
 * Typed HTTP client for SI/I.
 *
 * // Why: A thin class around `fetch` so command code reads as
 * // `await client.grant(project, user, role)` instead of marshalling
 * // headers + bodies inline. Native fetch (Node 20+) means zero
 * // runtime dependencies for the network surface; we ship our own
 * // `SIHttpError` so callers can branch on `error.status` cleanly.
 * //
 * // **Secret hygiene:** Tokens and access codes flow through this
 * // module but are NEVER logged, NEVER embedded in error messages,
 * // NEVER serialized except to the bytes-on-the-wire. Only status
 * // codes and the server's `error` field surface upward.
 *
 * @module http
 */

// ─── Response shapes ─────────────────────────────────────────────────────────

/**
 * Response from `POST /auth/request-code`.
 *
 * @requirement REQ-SI-NF-052
 */
export interface LoginRequestResponse {
  /** Server-supplied diagnostic message (e.g. "Check your email"). */
  message: string;
  /** Time-to-live for the code in seconds, when the server reports it. */
  expiresIn?: number;
}

/**
 * Response from `POST /auth/verify-code`.
 *
 * @requirement REQ-SI-NF-052
 */
export interface LoginVerifyResponse {
  authenticated: boolean;
  email?: string;
  token?: string;
  error?: string;
}

/**
 * Response from `POST /grants`.
 *
 * // Why: SI/I's actual handler returns the persisted `RoleGrant` row,
 * // which carries the audit-block reference as `auditBlock`. We surface
 * // those fields directly so command code can print them without
 * // re-shaping.
 *
 * @requirement REQ-SI-NF-052
 */
export interface GrantResponse {
  grantId: string;
  projectId: string;
  userId: string;
  role: string;
  grantedAt: string;
  grantedBy: string;
  auditBlock?: number;
}

/**
 * Response from `POST /grants/:grantId/revoke`.
 *
 * @requirement REQ-SI-NF-052
 */
export interface RevokeResponse {
  grantId: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  auditBlock?: number;
}

/**
 * Response from `POST /resolve`.
 *
 * @requirement REQ-SI-NF-052
 */
export interface ResolveResponse {
  userId: string;
  displayName: string;
  effectiveRoles: string[];
}

/**
 * Response from `GET /health`.
 *
 * @requirement REQ-SI-NF-052
 */
export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
}

// ─── Error ──────────────────────────────────────────────────────────────────

/**
 * HTTP-level error from an SI/I call.
 *
 * // Why: A typed error class makes try/catch sites less brittle than
 * // string-sniffing `Error.message`. `bodyJson` is best-effort — present
 * // when the server returned JSON, absent when it returned non-JSON or
 * // the network failed before any response arrived.
 *
 * @requirement REQ-SI-NF-052
 */
export class SIHttpError extends Error {
  readonly status: number;
  readonly bodyJson?: unknown;

  constructor(status: number, message: string, bodyJson?: unknown) {
    super(message);
    this.name = 'SIHttpError';
    this.status = status;
    this.bodyJson = bodyJson;
  }
}

// ─── Client ─────────────────────────────────────────────────────────────────

/**
 * Typed client for the SI/I HTTP API.
 *
 * Construct with the base URL of an SI/I deployment and (optionally) a
 * bearer token from a prior `si login`. Calls that need authentication
 * (`grant`, `revoke`, `resolve`) will fail with a 401 SIHttpError if no
 * token is set.
 *
 * @requirement REQ-SI-NF-052
 */
export class SIIdentityClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(baseUrl: string, token?: string) {
    // Why: Strip any trailing slash so `${baseUrl}/path` is always well-formed.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Request a one-time access code be sent to the given email.
   *
   * // Why: The server responds with `{ status, message }` even on success;
   * // we surface the message so the CLI can echo "Check your email" or
   * // whatever the deployment customized it to.
   */
  async requestCode(email: string): Promise<LoginRequestResponse> {
    const body = await this.postJson<{ status?: string; message?: string; expiresIn?: number }>(
      '/auth/request-code',
      { email },
      /* requireAuth */ false,
    );
    return {
      message: body.message ?? body.status ?? 'Code requested',
      expiresIn: body.expiresIn,
    };
  }

  /**
   * Verify a previously-issued access code and (on success) receive a
   * long-form bearer token.
   *
   * // Why: We do NOT throw on `authenticated: false` — that's a logical
   * // failure the caller wants to render as "wrong code" rather than as a
   * // network/HTTP error. We only throw for true HTTP errors (5xx, network
   * // failures).
   */
  async verifyCode(email: string, code: string): Promise<LoginVerifyResponse> {
    // Status 401 here means the code was wrong/expired; surface as a
    // structured "not authenticated" rather than throwing.
    const res = await fetch(`${this.baseUrl}/auth/verify-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const data = await this.parseBody(res);
    if (res.status === 200) {
      return data as LoginVerifyResponse;
    }
    if (res.status === 401 || res.status === 400) {
      // Synthesize a clean negative response with the server's error message.
      return {
        authenticated: false,
        error:
          (typeof data === 'object' && data && 'error' in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>).error)
            : 'Authentication failed'),
      };
    }
    throw this.errorFor(res, data);
  }

  // ─── Grants ───────────────────────────────────────────────────────────────

  /**
   * Grant a role on a project to a target user. Caller must hold the Owner
   * role on the project (server-enforced).
   *
   * // Why: The server's body key is `userId` per the existing schema. We
   * // expose the parameter as `targetUserId` here so command call sites
   * // read clearly ("grant: alice is granting bob the Operator role").
   */
  async grant(
    projectId: string,
    targetUserId: string,
    role: string,
  ): Promise<GrantResponse> {
    return await this.postJson<GrantResponse>(
      '/grants',
      { projectId, userId: targetUserId, role },
      /* requireAuth */ true,
    );
  }

  /**
   * Revoke a previously-issued grant by id.
   *
   * // Why: The body is intentionally `{ projectId }` so the server can
   * // cross-check the URL grantId against the asserted projectId — a defense
   * // against cut-and-paste mistakes that target the wrong project.
   */
  async revoke(projectId: string, grantId: string): Promise<RevokeResponse> {
    return await this.postJson<RevokeResponse>(
      `/grants/${encodeURIComponent(grantId)}/revoke`,
      { projectId },
      /* requireAuth */ true,
    );
  }

  // ─── Resolve / health ─────────────────────────────────────────────────────

  /**
   * Resolve the bound token to a userId + roles. Useful for sanity-checking
   * that the credentials file holds a still-valid token.
   */
  async resolve(): Promise<ResolveResponse> {
    return await this.postJson<ResolveResponse>('/resolve', {}, true);
  }

  /** GET /health. Never requires auth. */
  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    const data = await this.parseBody(res);
    if (!res.ok) throw this.errorFor(res, data);
    return data as HealthResponse;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async postJson<T>(
    path: string,
    body: unknown,
    requireAuth: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (requireAuth) {
      if (!this.token) {
        // Why: Failing fast with a 401-shaped error keeps the surface
        // consistent: callers can match `err.status === 401` whether the
        // server or the client emitted it.
        throw new SIHttpError(401, 'Authentication required (no token)');
      }
      headers.authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await this.parseBody(res);
    if (!res.ok) throw this.errorFor(res, data);
    return data as T;
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private errorFor(res: Response, data: unknown): SIHttpError {
    // Why: Prefer the server's `error` field, fall back to status text.
    // Never include request bodies in the message — those can carry codes.
    let msg = `${res.status} ${res.statusText || ''}`.trim();
    if (
      typeof data === 'object' &&
      data !== null &&
      'error' in (data as Record<string, unknown>)
    ) {
      msg = `${msg}: ${String((data as Record<string, unknown>).error)}`;
    }
    return new SIHttpError(res.status, msg, data);
  }
}
