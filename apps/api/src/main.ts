import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

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

async function bootstrap() {
  ensureDatabaseUrl();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

  const allowedOrigins = new Set(['http://127.0.0.1:3000', 'http://localhost:3000']);
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
