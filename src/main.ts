import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { SocketIoAdapter } from './common/utils/socket-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const port = config.get<number>('port', 3000);
  const apiPrefix = config.get<string>('apiPrefix', 'api');

  // Trust the first proxy hop so rate limiting sees the real client IP behind a LB.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Security headers
  app.use(helmet());

  // Gzip JSON/text responses. Cuts payload size ~70-80% on the read-heavy
  // BFF endpoints (home feed, organizer lists). Skips small/binary responses
  // automatically via the default threshold.
  app.use(compression());

  // CORS. In development, reflect any origin so other devices on the LAN
  // (phones, laptops) can reach the API. In production, lock to the configured origin.
  const isDev = config.get<string>('env') !== 'production';
  app.enableCors({
    origin: isDev ? true : config.get<string>('socket.corsOrigin'),
    credentials: true,
  });

  // Versioned-ish base path: /api/...
  app.setGlobalPrefix(apiPrefix, { exclude: ['health'] });

  // DTO validation + transformation everywhere
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // OpenAPI docs, auto-introspected from existing routes + DTOs (no per-route
  // decorators required). Served at /<apiPrefix>/docs. Disabled in production by
  // default to avoid exposing the full API surface; flip SWAGGER_ENABLED=true to
  // force it on.
  const swaggerEnabled = isDev || config.get<string>('SWAGGER_ENABLED') === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Evently API')
      .setDescription('Event-planning platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
  }

  // Socket.IO (chat /ws + /yjs namespaces)
  app.useWebSocketAdapter(new SocketIoAdapter(app, config));

  // Flush in-flight work on SIGTERM/SIGINT (containers, k8s)
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`Evently API listening on http://localhost:${port}/${apiPrefix}`);
  logger.log(`Health check at http://localhost:${port}/health`);
  if (swaggerEnabled) {
    logger.log(`API docs at http://localhost:${port}/${apiPrefix}/docs`);
  }
}

bootstrap();
