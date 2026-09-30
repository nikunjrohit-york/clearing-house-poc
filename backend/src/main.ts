import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('AvailityEngine');
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

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);

  logger.log(`Availity API listening on http://localhost:${port}`);
  logger.log(`REST base URL: ${configService.get<string>('AVAILITY_BASE_URL')}`);
  logger.log(`SFTP gateway: ${configService.get<string>('AVAILITY_SFTP_HOST')}:${configService.get<string>('AVAILITY_SFTP_PORT')}`);
}

bootstrap();
