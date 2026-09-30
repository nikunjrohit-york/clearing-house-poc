import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      validationSchema: Joi.object({
        AVAILITY_CLIENT_ID: Joi.string().default('sandbox'),
        AVAILITY_CLIENT_SECRET: Joi.string().default('sandbox'),
        AVAILITY_REALM: Joi.string().allow('').default(''),
        AVAILITY_SCOPE: Joi.string().allow('').default('hipaa'),
        AVAILITY_BASE_URL: Joi.string().uri().default('https://api.availity.com'),
        AVAILITY_TOKEN_URL: Joi.string().uri().default('https://api.availity.com/availity/v1/token'),
        AVAILITY_API_VERSION: Joi.string().default('v1'),
        AVAILITY_SUBMITTER_ID: Joi.string().default('AV09311993'),
        AVAILITY_RECEIVER_ID: Joi.string().default('030240928'),
        AVAILITY_USAGE_INDICATOR: Joi.string().valid('T', 'P').default('T'),
        AVAILITY_SFTP_HOST: Joi.string().default('qa-files.availity.com'),
        AVAILITY_SFTP_PORT: Joi.number().port().default(22),
        AVAILITY_SFTP_USERNAME: Joi.string().default('sandbox'),
        AVAILITY_SFTP_PASSWORD: Joi.string().allow('').default(''),
        AVAILITY_SFTP_PRIVATE_KEY_PATH: Joi.string().allow('').optional(),
        AVAILITY_SFTP_SEND_PATH: Joi.string().default('/SendFiles'),
        AVAILITY_SFTP_RECEIVE_PATH: Joi.string().default('/ReceiveFiles'),
        AVAILITY_SFTP_INBOUND_PATH: Joi.string().default('/ReceiveFiles'),
        AVAILITY_SFTP_OUTBOUND_PATH: Joi.string().default('/SendFiles'),
        PORT: Joi.number().port().default(3000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('debug'),
      }),
    }),
  ],
  exports: [ConfigModule],
})
export class AvailityConfigModule {}
