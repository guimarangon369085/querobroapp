import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const dataDir = path.join(repoRoot, 'data', 'alexa');
const oauthStorePath = path.join(dataDir, 'oauth-store.json');

const authorizeQuerySchema = z.object({
  response_type: z.string().trim().min(1).max(40),
  client_id: z.string().trim().min(1).max(220),
  redirect_uri: z.string().trim().url(),
  state: z.string().trim().min(1).max(600),
  scope: z.string().trim().max(1000).optional().default(''),
  code_challenge: z.string().trim().max(200).optional().default(''),
  code_challenge_method: z.string().trim().max(20).optional().default('')
});

const approveAuthorizeBodySchema = authorizeQuerySchema.extend({
  link_token: z.string().trim().min(1).max(300)
});

const tokenBodySchema = z.object({
  grant_type: z.string().trim().min(1).max(40),
  code: z.string().trim().max(300).optional().default(''),
  redirect_uri: z.string().trim().url().optional().default(''),
  client_id: z.string().trim().max(220).optional().default(''),
  client_secret: z.string().trim().max(220).optional().default(''),
  code_verifier: z.string().trim().max(300).optional().default(''),
  refresh_token: z.string().trim().max(400).optional().default(''),
  scope: z.string().trim().max(1000).optional().default('')
});

type AuthorizeQueryInput = z.output<typeof authorizeQuerySchema>;
type ApproveAuthorizeBodyInput = z.output<typeof approveAuthorizeBodySchema>;
type TokenBodyInput = z.output<typeof tokenBodySchema>;

type OAuthCodeRecord = {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  subject: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  createdAt: string;
  expiresAt: string;
};

type OAuthAccessTokenRecord = {
  tokenHash: string;
  clientId: string;
  subject: string;
  scope: string;
  refreshTokenHash: string;
  createdAt: string;
  expiresAt: string;
};

type OAuthRefreshTokenRecord = {
  tokenHash: string;
  clientId: string;
  subject: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string;
};

type OAuthStore = {
  version: 1;
  codes: OAuthCodeRecord[];
  accessTokens: OAuthAccessTokenRecord[];
  refreshTokens: OAuthRefreshTokenRecord[];
};

type ValidatedAccessToken = {
  clientId: string;
  subject: string;
  scope: string;
  expiresAt: string;
};

@Injectable()
export class AlexaOauthService {
  private readonly isProduction = (process.env.NODE_ENV || 'development') === 'production';
  private readonly clientId = (process.env.ALEXA_OAUTH_CLIENT_ID || '').trim();
  private readonly clientSecret = (process.env.ALEXA_OAUTH_CLIENT_SECRET || '').trim();
  private readonly linkToken = (process.env.ALEXA_OAUTH_LINK_TOKEN || '').trim();
  private readonly defaultScope = (process.env.ALEXA_OAUTH_SCOPE_DEFAULT || 'alexa:bridge').trim();
  private readonly defaultSubject = (process.env.ALEXA_OAUTH_DEFAULT_SUBJECT || 'alexa-linked-operator').trim();
  private readonly requirePkce = this.resolveBooleanEnv(process.env.ALEXA_OAUTH_REQUIRE_PKCE, true);
  private readonly requireAccountLinking = this.resolveBooleanEnv(
    process.env.ALEXA_REQUIRE_ACCOUNT_LINKING,
    this.isProduction
  );
  private readonly codeTtlSeconds = this.resolveTtlSeconds(process.env.ALEXA_OAUTH_CODE_TTL_SECONDS, 300, 60, 900);
  private readonly accessTokenTtlSeconds = this.resolveTtlSeconds(
    process.env.ALEXA_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    900,
    300,
    86_400
  );
  private readonly refreshTokenTtlSeconds = this.resolveTtlSeconds(
    process.env.ALEXA_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    2_592_000,
    3_600,
    31_536_000
  );
  private readonly redirectUriAllowlist = new Set(
    (process.env.ALEXA_OAUTH_REDIRECT_URI_ALLOWLIST || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  private loadPromise: Promise<void> | null = null;
  private persistChain = Promise.resolve();
  private store: OAuthStore = {
    version: 1,
    codes: [],
    accessTokens: [],
    refreshTokens: []
  };

  async renderAuthorizePage(query: unknown) {
    await this.ensureLoaded();
    this.ensureOAuthConfig();
    const input = this.validateAuthorizeRequest(query);

    const safe = {
      clientId: this.escapeHtml(input.client_id),
      redirectUri: this.escapeHtml(input.redirect_uri),
      responseType: this.escapeHtml(input.response_type),
      state: this.escapeHtml(input.state),
      scope: this.escapeHtml(input.scope || ''),
      codeChallenge: this.escapeHtml(input.code_challenge || ''),
      codeChallengeMethod: this.escapeHtml(input.code_challenge_method || '')
    };

    return [
      '<!doctype html>',
      '<html lang="pt-BR">',
      '<head>',
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<title>Vincular Alexa ao QUEROBROAPP</title>',
      '<style>',
      'body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4efe7;color:#2a2118;padding:24px;}',
      '.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5d9c8;border-radius:16px;padding:24px;box-shadow:0 12px 40px rgba(42,33,24,.08);}',
      'h1{font-size:22px;margin:0 0 12px;}',
      'p{line-height:1.5;color:#5b4a3a;}',
      'label{display:block;font-weight:600;margin:18px 0 8px;}',
      'input{width:100%;padding:14px 12px;border-radius:12px;border:1px solid #ccb8a0;font-size:16px;}',
      'button{margin-top:18px;border:0;border-radius:999px;padding:14px 18px;background:#b85a2b;color:#fff;font-weight:700;cursor:pointer;}',
      '.meta{margin-top:18px;font-size:13px;color:#7b6958;}',
      '</style>',
      '</head>',
      '<body>',
      '<div class="card">',
      '<h1>Vincular Alexa ao QUEROBROAPP</h1>',
      '<p>Use seu token de vinculo para autorizar a skill a consultar e disparar automacoes do QUEROBROAPP.</p>',
      '<form method="post" action="/alexa/oauth/authorize/approve" autocomplete="off">',
      `<input type="hidden" name="client_id" value="${safe.clientId}" />`,
      `<input type="hidden" name="redirect_uri" value="${safe.redirectUri}" />`,
      `<input type="hidden" name="response_type" value="${safe.responseType}" />`,
      `<input type="hidden" name="state" value="${safe.state}" />`,
      `<input type="hidden" name="scope" value="${safe.scope}" />`,
      `<input type="hidden" name="code_challenge" value="${safe.codeChallenge}" />`,
      `<input type="hidden" name="code_challenge_method" value="${safe.codeChallengeMethod}" />`,
      '<label for="link_token">Token de vinculo</label>',
      '<input id="link_token" name="link_token" type="password" required />',
      '<button type="submit">Autorizar Alexa</button>',
      `<div class="meta">Client ID: ${safe.clientId}</div>`,
      '</form>',
      '</div>',
      '</body>',
      '</html>'
    ].join('');
  }

  async approveAuthorize(body: unknown) {
    await this.ensureLoaded();
    this.ensureOAuthConfig();
    const input = parseWithSchema(approveAuthorizeBodySchema, body) as ApproveAuthorizeBodyInput;
    const authorizeInput = this.validateAuthorizeRequest(input);

    if (!this.secureCompareString(input.link_token, this.linkToken)) {
      throw new BadRequestException('Token de vinculo invalido.');
    }

    const issuedCode = this.randomOpaqueToken(24);
    const now = Date.now();
    const record: OAuthCodeRecord = {
      codeHash: this.hashOpaqueToken(issuedCode),
      clientId: authorizeInput.client_id,
      redirectUri: authorizeInput.redirect_uri,
      state: authorizeInput.state,
      scope: this.normalizeScope(authorizeInput.scope || ''),
      subject: this.defaultSubject,
      codeChallenge: (authorizeInput.code_challenge || '').trim(),
      codeChallengeMethod: (authorizeInput.code_challenge_method || '').trim().toUpperCase(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.codeTtlSeconds * 1000).toISOString()
    };

    this.store.codes.push(record);
    this.cleanupStore(now);
    await this.persistStore();

    const redirectUrl = new URL(authorizeInput.redirect_uri);
    redirectUrl.searchParams.set('state', authorizeInput.state);
    redirectUrl.searchParams.set('code', issuedCode);
    return redirectUrl.toString();
  }

  async exchangeToken(payload: unknown, authorizationHeader?: string) {
    await this.ensureLoaded();
    this.ensureOAuthConfig();

    const input = parseWithSchema(tokenBodySchema, payload) as TokenBodyInput;
    const credentials = this.extractClientCredentials(input, authorizationHeader);

    if (!this.secureCompareString(credentials.clientId, this.clientId)) {
      throw new BadRequestException('client_id invalido.');
    }
    if (!this.secureCompareString(credentials.clientSecret, this.clientSecret)) {
      throw new BadRequestException('client_secret invalido.');
    }

    const now = Date.now();
    this.cleanupStore(now);

    if (input.grant_type === 'authorization_code') {
      return this.exchangeAuthorizationCode(input, now);
    }

    if (input.grant_type === 'refresh_token') {
      return this.exchangeRefreshToken(input, now);
    }

    throw new BadRequestException('grant_type nao suportado. Use authorization_code ou refresh_token.');
  }

  async validateAccessToken(accessToken: string) {
    await this.ensureLoaded();
    const token = (accessToken || '').trim();
    if (!token) return null;

    const now = Date.now();
    this.cleanupStore(now);
    const tokenHash = this.hashOpaqueToken(token);
    const record = this.store.accessTokens.find(
      (entry) => entry.tokenHash === tokenHash && new Date(entry.expiresAt).getTime() > now
    );

    if (!record) return null;
    return {
      clientId: record.clientId,
      subject: record.subject,
      scope: record.scope,
      expiresAt: record.expiresAt
    } as ValidatedAccessToken;
  }

  isAccountLinkingRequired() {
    return this.requireAccountLinking;
  }

  hasRequiredConfigForEnforcedLinking() {
    return Boolean(this.clientId && this.clientSecret && this.linkToken && this.redirectUriAllowlist.size > 0);
  }

  private exchangeAuthorizationCode(input: TokenBodyInput, now: number) {
    const code = (input.code || '').trim();
    if (!code) {
      throw new BadRequestException('code obrigatorio para authorization_code.');
    }

    const redirectUri = (input.redirect_uri || '').trim();
    if (!redirectUri) {
      throw new BadRequestException('redirect_uri obrigatorio para authorization_code.');
    }

    const codeHash = this.hashOpaqueToken(code);
    const recordIndex = this.store.codes.findIndex((entry) => entry.codeHash === codeHash);
    if (recordIndex < 0) {
      throw new BadRequestException('authorization code invalido.');
    }

    const record = this.store.codes[recordIndex];
    if (!record) {
      throw new BadRequestException('authorization code invalido.');
    }

    if (record.clientId !== this.clientId) {
      throw new BadRequestException('authorization code emitido para outro client_id.');
    }
    if (record.redirectUri !== redirectUri) {
      throw new BadRequestException('redirect_uri nao confere com o authorization code.');
    }
    if (new Date(record.expiresAt).getTime() <= now) {
      this.store.codes.splice(recordIndex, 1);
      throw new BadRequestException('authorization code expirado.');
    }

    if (this.requirePkce) {
      const verifier = (input.code_verifier || '').trim();
      if (!verifier) {
        throw new BadRequestException('code_verifier obrigatorio quando PKCE esta ativo.');
      }
      this.verifyPkce(record, verifier);
    }

    this.store.codes.splice(recordIndex, 1);
    const scope = this.normalizeScope(record.scope);
    const tokens = this.issueTokenPair(record.subject, scope, now);
    return {
      access_token: tokens.accessToken,
      token_type: 'bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: tokens.refreshToken,
      scope
    };
  }

  private exchangeRefreshToken(input: TokenBodyInput, now: number) {
    const refreshToken = (input.refresh_token || '').trim();
    if (!refreshToken) {
      throw new BadRequestException('refresh_token obrigatorio para refresh_token grant.');
    }

    const tokenHash = this.hashOpaqueToken(refreshToken);
    const recordIndex = this.store.refreshTokens.findIndex(
      (entry) =>
        entry.tokenHash === tokenHash &&
        !entry.revokedAt &&
        new Date(entry.expiresAt).getTime() > now
    );

    if (recordIndex < 0) {
      throw new BadRequestException('refresh_token invalido ou expirado.');
    }

    const record = this.store.refreshTokens[recordIndex];
    if (!record) {
      throw new BadRequestException('refresh_token invalido ou expirado.');
    }

    if (record.clientId !== this.clientId) {
      throw new BadRequestException('refresh_token emitido para outro client_id.');
    }

    record.revokedAt = new Date(now).toISOString();
    const scope = this.normalizeScope(input.scope || record.scope || '');
    const tokens = this.issueTokenPair(record.subject, scope, now);

    return {
      access_token: tokens.accessToken,
      token_type: 'bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: tokens.refreshToken,
      scope
    };
  }

  private issueTokenPair(subject: string, scope: string, now: number) {
    const accessToken = this.randomOpaqueToken(32);
    const refreshToken = this.randomOpaqueToken(40);
    const accessTokenHash = this.hashOpaqueToken(accessToken);
    const refreshTokenHash = this.hashOpaqueToken(refreshToken);

    this.store.accessTokens.push({
      tokenHash: accessTokenHash,
      clientId: this.clientId,
      subject,
      scope,
      refreshTokenHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.accessTokenTtlSeconds * 1000).toISOString()
    });

    this.store.refreshTokens.push({
      tokenHash: refreshTokenHash,
      clientId: this.clientId,
      subject,
      scope,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.refreshTokenTtlSeconds * 1000).toISOString(),
      revokedAt: ''
    });

    void this.persistStore().catch(() => undefined);

    return { accessToken, refreshToken };
  }

  private verifyPkce(record: OAuthCodeRecord, verifier: string) {
    const challenge = (record.codeChallenge || '').trim();
    const method = (record.codeChallengeMethod || '').trim().toUpperCase();

    if (!challenge || method !== 'S256') {
      throw new BadRequestException('authorization code sem PKCE valido.');
    }

    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    if (!this.secureCompareString(challenge, expected)) {
      throw new BadRequestException('code_verifier invalido.');
    }
  }

  private validateAuthorizeRequest(raw: unknown) {
    const input = parseWithSchema(authorizeQuerySchema, raw) as AuthorizeQueryInput;

    if (input.response_type !== 'code') {
      throw new BadRequestException('response_type invalido. Use code.');
    }
    if (input.client_id !== this.clientId) {
      throw new BadRequestException('client_id invalido.');
    }
    if (!this.redirectUriAllowlist.has(input.redirect_uri)) {
      throw new BadRequestException('redirect_uri nao autorizado para account linking.');
    }
    if (this.requirePkce) {
      if (!input.code_challenge) {
        throw new BadRequestException('code_challenge obrigatorio quando PKCE esta ativo.');
      }
      if ((input.code_challenge_method || '').trim().toUpperCase() !== 'S256') {
        throw new BadRequestException('code_challenge_method invalido. Use S256.');
      }
    }

    return input;
  }

  private extractClientCredentials(input: TokenBodyInput, authorizationHeader?: string) {
    const header = (authorizationHeader || '').trim();
    if (/^basic\s+/i.test(header)) {
      const base64Value = header.replace(/^basic\s+/i, '').trim();
      let decoded = '';
      try {
        decoded = Buffer.from(base64Value, 'base64').toString('utf8');
      } catch {
        throw new BadRequestException('Authorization Basic invalido.');
      }
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex <= 0) {
        throw new BadRequestException('Authorization Basic invalido.');
      }
      return {
        clientId: decoded.slice(0, separatorIndex),
        clientSecret: decoded.slice(separatorIndex + 1)
      };
    }

    return {
      clientId: (input.client_id || '').trim(),
      clientSecret: (input.client_secret || '').trim()
    };
  }

  private ensureOAuthConfig() {
    if (!this.clientId) {
      throw new BadRequestException('ALEXA_OAUTH_CLIENT_ID nao configurado.');
    }
    if (!this.clientSecret) {
      throw new BadRequestException('ALEXA_OAUTH_CLIENT_SECRET nao configurado.');
    }
    if (!this.linkToken) {
      throw new BadRequestException('ALEXA_OAUTH_LINK_TOKEN nao configurado.');
    }
    if (this.redirectUriAllowlist.size === 0) {
      throw new BadRequestException('ALEXA_OAUTH_REDIRECT_URI_ALLOWLIST vazio.');
    }
  }

  private normalizeScope(rawValue: string) {
    const parts = (rawValue || '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (parts.length === 0) return this.defaultScope;
    return Array.from(new Set(parts)).join(' ');
  }

  private randomOpaqueToken(bytes: number) {
    return randomBytes(bytes).toString('base64url');
  }

  private hashOpaqueToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private secureCompareString(left: string, right: string) {
    const normalizedLeft = String(left || '');
    const normalizedRight = String(right || '');
    if (normalizedLeft.length !== normalizedRight.length) return false;

    try {
      return timingSafeEqual(Buffer.from(normalizedLeft), Buffer.from(normalizedRight));
    } catch {
      return false;
    }
  }

  private resolveBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null) return fallback;
    const value = rawValue.trim().toLowerCase();
    if (!value) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
  }

  private resolveTtlSeconds(rawValue: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(rawValue || fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  private cleanupStore(now = Date.now()) {
    this.store.codes = this.store.codes.filter((entry) => new Date(entry.expiresAt).getTime() > now);
    this.store.accessTokens = this.store.accessTokens.filter(
      (entry) => new Date(entry.expiresAt).getTime() > now
    );
    this.store.refreshTokens = this.store.refreshTokens.filter(
      (entry) => !entry.revokedAt && new Date(entry.expiresAt).getTime() > now
    );
  }

  private async ensureLoaded() {
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = this.loadStore();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async loadStore() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(oauthStorePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OAuthStore>;
      this.store = {
        version: 1,
        codes: Array.isArray(parsed.codes) ? (parsed.codes as OAuthCodeRecord[]) : [],
        accessTokens: Array.isArray(parsed.accessTokens)
          ? (parsed.accessTokens as OAuthAccessTokenRecord[])
          : [],
        refreshTokens: Array.isArray(parsed.refreshTokens)
          ? (parsed.refreshTokens as OAuthRefreshTokenRecord[])
          : []
      };
      this.cleanupStore();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw new InternalServerErrorException('Falha ao carregar store OAuth da Alexa.');
      }
      this.store = {
        version: 1,
        codes: [],
        accessTokens: [],
        refreshTokens: []
      };
      await this.persistStore();
    }
  }

  private async persistStore() {
    const payload = JSON.stringify(this.store, null, 2);
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(oauthStorePath, payload, 'utf8');
      });
    await this.persistChain;
  }

  private escapeHtml(value: string) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
