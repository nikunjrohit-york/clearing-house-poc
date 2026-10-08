import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { validateAvailityConfigOrThrow } from './config/availity-env';

async function bootstrap() {
  const logger = new Logger('AvailityEngine');
  validateAvailityConfigOrThrow(process.env);

  const { NestFactory } = await import('@nestjs/core');
  const { ConfigService } = await import('@nestjs/config');
  const { AppModule } = await import('./app.module');
  const { AvailityExceptionFilter } = await import('./common/availity-exception.filter');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AvailityExceptionFilter());

  validateAvailityConfigOrThrow(process.env);

  const port = configService.get<number>('PORT');
  if (!port) {
    throw new Error('PORT is required');
  }
  await app.listen(port);

  logger.log(`Availity API listening on http://localhost:${port}`);
  logger.log(`REST base URL: ${configService.get<string>('AVAILITY_BASE_URL')}`);
  logger.log(`SFTP gateway: ${configService.get<string>('AVAILITY_SFTP_HOST')}:${configService.get<string>('AVAILITY_SFTP_PORT')}`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
