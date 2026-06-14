import 'dotenv/config';
import type { OAuth2TokenResponse, ApiResponse } from './types.js';

const BASE_URL = 'https://openapi.tossinvest.com';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function fetchToken(): Promise<string> {
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TOSS_CLIENT_ID and TOSS_CLIENT_SECRET must be set in .env');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(`OAuth token fetch failed (${res.status}): ${err['error'] ?? ''} ${err['error_description'] ?? ''}`);
  }

  const data = await res.json() as OAuth2TokenResponse;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }
  return fetchToken();
}

export async function tossGet<T>(
  path: string,
  opts: { accountSeq?: number; params?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (opts.accountSeq !== undefined) {
      headers['X-Tossinvest-Account'] = String(opts.accountSeq);
    }

    const res = await fetch(url.toString(), { headers });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      const wait = (isNaN(retryAfter) ? 5 : retryAfter) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (res.status === 401) {
      tokenCache = null;
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      const msg = err.error?.message ?? err.error?.code ?? String(res.status);
      throw new Error(`Toss API ${path} failed (${res.status}): ${msg}`);
    }

    const data = await res.json() as ApiResponse<T>;
    return data.result;
  }

  throw new Error(`Toss API ${path} failed after retries`);
}

export function clearTokenCache(): void {
  tokenCache = null;
}
