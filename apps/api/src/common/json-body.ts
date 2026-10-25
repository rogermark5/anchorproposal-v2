import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureJsonBody(app: NestExpressApplication): void {
  // An 80,000-character prompt can exceed Express's default 100 KiB after
  // Unicode encoding or JSON escaping. Keep a bounded transport allowance.
  app.useBodyParser('json', { limit: '1mb' });
}
