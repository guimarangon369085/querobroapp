import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { UPLOADS_DIR } from './modules/runtime-config/runtime-config.service.js';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter.js';
import { getSecurityRuntimeConfig } from './security/security-config.js';
import { PrismaService } from './prisma.service.js';

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function sanitizeLogText(value: string, fallback: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.slice(0, 320);
}

function serializeExceptionForLog(error: unknown) {
  if (error instanceof Error) {
    const maybeError = error as ErrorLike;
    const code = maybeError.code;
    const status = maybeError.statusCode ?? maybeError.status;
    return {
      errorName: sanitizeLogText(error.name || 'Error', 'Error'),
      errorMessage: sanitizeLogText(error.message || '', 'Unhandled error'),
      ...(typeof code === 'string' || typeof code === 'number' ? { errorCode: String(code) } : {}),
      ...(typeof status === 'number' ? { statusCode: status } : {})
    };
  }

  if (error && typeof error === 'object') {
    const maybeError = error as ErrorLike;
    const name = typeof maybeError.name === 'string' ? maybeError.name : 'NonErrorThrow';
    const message = typeof maybeError.message === 'string' ? maybeError.message : '';
    const code = maybeError.code;
    const status = maybeError.statusCode ?? maybeError.status;
    return {
      errorName: sanitizeLogText(name, 'NonErrorThrow'),
      errorMessage: sanitizeLogText(message, 'Unhandled non-error rejection'),
      ...(typeof code === 'string' || typeof code === 'number' ? { errorCode: String(code) } : {}),
      ...(typeof status === 'number' ? { statusCode: status } : {})
    };
  }

  return {
    errorName: 'NonErrorThrow',
    errorMessage: sanitizeLogText(String(error ?? ''), 'Unhandled non-error rejection')
  };
}

function logProcessException(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      event,
      loggedAt: new Date().toISOString(),
      ...serializeExceptionForLog(error)
    })
  );
}

function normalizeHost(host: string | undefined) {
  return (host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.+)\]$/, '$1');
}

function resolveListenHost() {
  return normalizeHost(process.env.HOST) || '127.0.0.1';
}

function isLoopbackHost(host: string) {
  const normalized = normalizeHost(host);
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  );
}

function isPublicBindHost(host: string) {
  return !isLoopbackHost(host);
}

process.on('unhandledRejection', (reason) => {
  logProcessException('unhandled_rejection', reason);
});

process.on('uncaughtException', (error) => {
  logProcessException('uncaught_exception', error);
});

function isMissingCustomerDeletedAtColumnError(
  value: unknown
): value is Prisma.PrismaClientKnownRequestError {
  if (!(value instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return (
    value.code === 'P2022' &&
    typeof value.message === 'string' &&
    value.message.includes('Customer.deletedAt')
  );
}

function resolveDeletedAtColumnType() {
  const dbUrl = (process.env.DATABASE_URL || '').toLowerCase();
  if (dbUrl.startsWith('file:')) {
    return 'DATETIME';
  }
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    return 'TIMESTAMP';
  }
  return 'TIMESTAMP';
}

async function ensureCustomerDeletedAtColumn() {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    await prisma.customer.findFirst({ where: { deletedAt: null }, take: 1 });
  } catch (error) {
    if (!isMissingCustomerDeletedAtColumnError(error)) {
      throw error;
    }
    const columnType = resolveDeletedAtColumnType();
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Customer" ADD COLUMN "deletedAt" ${columnType}`
    );
    console.log('Customer.deletedAt column added automatically.');
  } finally {
    await prisma.$disconnect();
  }
}

function ensureDatabaseUrl() {
  const isDev = (process.env.NODE_ENV || 'development') === 'development';
  if (isDev && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./dev.db';
  }
  if (!isDev && !process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseAllowedOrigins() {
  const defaults = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  const fromEnv = (process.env.APP_CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...defaults, ...fromEnv]);
}

function isLoopbackOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.trim().toLowerCase();
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  requestId?: string;
  authPrincipal?: {
    role?: string;
    tokenLabel?: string;
  };
};

type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
};

async function bootstrap() {
  ensureDatabaseUrl();
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  const host = resolveListenHost();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  if (!isProd) {
    await ensureCustomerDeletedAtColumn();
  }
  const securityConfig = getSecurityRuntimeConfig();
  const allowUnsafeAuthInProd = parseBooleanEnv(process.env.APP_ALLOW_UNSAFE_AUTH_IN_PROD, false);
  const allowUnsafeAuthOnPublicHost = parseBooleanEnv(
    process.env.APP_ALLOW_UNSAFE_AUTH_ON_PUBLIC_HOST,
    false
  );

  if (isProd && !securityConfig.enabled && !allowUnsafeAuthInProd) {
    throw new Error(
      'NODE_ENV=production exige APP_AUTH_ENABLED=true. Use APP_ALLOW_UNSAFE_AUTH_IN_PROD=true apenas para excecoes temporarias.'
    );
  }

  if (
    !securityConfig.enabled &&
    isPublicBindHost(host) &&
    !allowUnsafeAuthOnPublicHost &&
    !(isProd && allowUnsafeAuthInProd)
  ) {
    throw new Error(
      `Inicializacao bloqueada: APP_AUTH_ENABLED=false com HOST=${host} exporia a API sem autenticacao. Use HOST loopback (127.0.0.1/localhost) ou defina APP_ALLOW_UNSAFE_AUTH_ON_PUBLIC_HOST=true conscientemente.`
    );
  }

  if (securityConfig.enabled && securityConfig.tokensBySecret.size === 0) {
    throw new Error(
      'APP_AUTH_ENABLED=true, mas nenhum token foi configurado. Defina APP_AUTH_TOKEN ou APP_AUTH_TOKENS.'
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalFilters(new ZodExceptionFilter());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );

  app.use((req: RequestLike, res: ResponseLike, next: () => void) => {
    const incomingId = String(req.headers['x-request-id'] || '').trim();
    const requestId = incomingId || randomUUID();
    const start = process.hrtime.bigint();
    const startedAt = new Date().toISOString();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const principal = req.authPrincipal;
      console.log(
        JSON.stringify({
          event: 'http_request',
          requestId,
          method: req.method,
          path: req.originalUrl?.split('?')[0] || req.url,
          statusCode: res.statusCode,
          durationMs: Math.round(elapsedMs * 100) / 100,
          ip: req.ip,
          authRole: principal?.role || 'anonymous',
          authSource: principal?.tokenLabel || '',
          startedAt
        })
      );
    });

    next();
  });

  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });
  app.useStaticAssets(UPLOADS_DIR, { prefix: '/uploads/builder/home/' });

  const allowedOrigins = parseAllowedOrigins();
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin) || isLoopbackOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true
  });

  const enableSwagger = process.env.ENABLE_SWAGGER === 'true';
  const allowSwaggerInProd = parseBooleanEnv(process.env.APP_ALLOW_SWAGGER_IN_PROD, false);
  if (isProd && enableSwagger && !allowSwaggerInProd) {
    throw new Error(
      'Swagger em producao esta bloqueado por padrao. Defina APP_ALLOW_SWAGGER_IN_PROD=true para liberar conscientemente.'
    );
  }

  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('QuerobroApp API')
      .setDescription('API ERP para produtos, clientes, pedidos, pagamentos e estoque')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port, host);
  console.log(`API Nest rodando em http://${host}:${port}`);
}

bootstrap().catch((err) => {
  logProcessException('bootstrap_error', err);
  process.exit(1);
});
