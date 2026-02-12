import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { UPLOADS_DIR } from './modules/builder/builder.service.js';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter.js';
import { getSecurityRuntimeConfig } from './security/security-config.js';

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('UncaughtException:', error);
});

function ensureDatabaseUrl() {
  const isDev = (process.env.NODE_ENV || 'development') === 'development';
  if (isDev && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./dev.db';
  }
  if (!isDev && !process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
  }
}

function parseAllowedOrigins() {
  const defaults = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  const fromEnv = (process.env.APP_CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...defaults, ...fromEnv]);
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
  const securityConfig = getSecurityRuntimeConfig();
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
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true
  });

  const enableSwagger = process.env.ENABLE_SWAGGER === 'true';
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('QuerobroApp API')
      .setDescription('API ERP para produtos, clientes, pedidos, pagamentos e estoque')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`API Nest rodando em http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap error:', err);
  process.exit(1);
});
