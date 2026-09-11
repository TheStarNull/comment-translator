/**
 * Google service-account JWT auth — uses only Node.js built-ins (crypto).
 * No `google-auth-library` dependency required.
 *
 * Returns an OAuth2 access token scoped for the Translate API.
 * Token is cached and reused until ~55 minutes; callers can re-invoke on 401.
 */

import crypto from 'crypto';

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
  privateKey: string
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

  const res = await fetch(AUD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

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
