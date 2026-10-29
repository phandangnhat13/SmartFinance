import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './common/logger/json-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const logger = new JsonLogger();
  app.useLogger(logger);

  configureApp(app);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT', '3000'));

  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
