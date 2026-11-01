import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureJsonBody } from './common/json-body';

function resolveCorsOrigins(): string[] | boolean {
  const configured = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3100',
    'http://127.0.0.1:3100',
  ];
  const origins = [...new Set([...defaults, ...configured])];
  return origins.length > 0 ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureJsonBody(app);
  app.enableCors({ origin: resolveCorsOrigins(), credentials: true, exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Retry-After'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.API_PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://127.0.0.1:${port}`);
}
bootstrap();
