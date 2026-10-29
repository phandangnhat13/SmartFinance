import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Shared application configuration for `main.ts` and the e2e tests, so tests
 * exercise the same middleware, validation and error contract as production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const allowedOrigins = (config.get<string>('WEB_ORIGIN', 'http://localhost:5173') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // CSRF defence in depth: cookies are SameSite=Lax and browser requests with a
  // foreign Origin are rejected. Non-browser clients (no Origin) still work.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const method = request.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      response.status(403).json({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Origin không được phép',
      });
      return;
    }
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method) && hasBody) {
      const contentType = request.headers['content-type'] ?? '';
      if (
        !contentType.includes('application/json') &&
        !contentType.includes('multipart/form-data')
      ) {
        response.status(415).json({
          statusCode: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type phải là application/json hoặc multipart/form-data',
        });
        return;
      }
    }
    return next();
  });

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Finance API')
    .setDescription(
      'API quản lý tài chính cá nhân. Xác thực bằng cookie HttpOnly hoặc Bearer token.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('sf_access_token', { type: 'apiKey', in: 'cookie' })
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}
