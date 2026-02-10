import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

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

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true
  });

  const config = new DocumentBuilder()
    .setTitle('QuerobroApp API')
    .setDescription('API ERP para produtos, clientes, pedidos, pagamentos e estoque')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`API Nest rodando em http://${host}:${port}`);
}

bootstrap();
