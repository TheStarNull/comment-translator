/**
 * Google service-account JWT auth — uses only Node.js built-ins (crypto).
 * No `google-auth-library` dependency required.
 *
 * Returns an OAuth2 access token scoped for the Translate API.
 * Token is cached and reused until ~55 minutes; callers can re-invoke on 401.
 *
 * The token exchange runs under a hard deadline (see ./fetch-timeout): a
 * stalled OAuth endpoint must not be able to hang the whole translation run.
 */

import crypto from 'crypto';
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout } from './fetch-timeout';

interface JWTHeader {
  alg: 'RS256';
  typ: 'JWT';
  kid: string;
}

interface JWTClaims {
  iss: string;
  scope: string;
  aud: string;
  exp: number;
  iat: number;
}

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const AUD = 'https://oauth2.googleapis.com/token';

export interface GoogleAuthOptions {
  /** Deadline for the token exchange, in ms. Default 30000. */
  timeoutMs?: number;
  /** Override the token endpoint (tests / private proxies). Defaults to Google's. */
  tokenUrl?: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Sign a JWT with the service account's private key and exchange it for an
 * access token via Google's token endpoint.
 */
export async function googleAuthAssertion(
  clientEmail: string,
  privateKey: string,
  options: GoogleAuthOptions = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header: JWTHeader = { alg: 'RS256', typ: 'JWT', kid: clientEmail };
  const claims: JWTClaims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: AUD,
    exp: now + 60 * 60, // 1 hour
    iat: now,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = `${unsigned}.${signature}`;

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const res = await fetchWithTimeout(
    options.tokenUrl ?? AUD,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'Google OAuth token exchange'
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google auth failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Google auth response did not include access_token.');
  }
  return data.access_token;
}
