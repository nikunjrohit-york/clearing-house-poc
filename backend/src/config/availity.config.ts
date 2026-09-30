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
        AVAILITY_ALLOW_ENV_MISMATCH: Joi.string().valid('true', 'false').default('false'),
        AVAILITY_ALLOW_INCOMPLETE_CONFIG: Joi.string().valid('true', 'false').default('true'),
        AVAILITY_CONTROL_NUMBER_STORE: Joi.string().allow('').optional(),
        AVAILITY_COVERAGE_POLL_ATTEMPTS: Joi.number().integer().min(1).default(15),
        AVAILITY_COVERAGE_POLL_INTERVAL_MS: Joi.number().integer().min(0).default(2000),
        PORT: Joi.number().port().default(3000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('debug'),
      }).custom((value, helpers) => {
        const host = String(value.AVAILITY_SFTP_HOST || '');
        const usage = String(value.AVAILITY_USAGE_INDICATOR || 'T');
        const allowMismatch = value.AVAILITY_ALLOW_ENV_MISMATCH === 'true';
        if (!allowMismatch && host === 'qa-files.availity.com' && usage === 'P') {
          return helpers.error('any.custom', {
            message: 'QA host qa-files.availity.com requires AVAILITY_USAGE_INDICATOR=T unless AVAILITY_ALLOW_ENV_MISMATCH=true',
          });
        }
        if (!allowMismatch && host === 'files.availity.com' && usage === 'T') {
          return helpers.error('any.custom', {
            message: 'Production host files.availity.com requires AVAILITY_USAGE_INDICATOR=P unless AVAILITY_ALLOW_ENV_MISMATCH=true',
          });
        }
        const password = String(value.AVAILITY_SFTP_PASSWORD || '');
        const privateKey = String(value.AVAILITY_SFTP_PRIVATE_KEY_PATH || '');
        if (password && privateKey) {
          return helpers.error('any.custom', {
            message: 'Set AVAILITY_SFTP_PASSWORD or AVAILITY_SFTP_PRIVATE_KEY_PATH, not both',
          });
        }
        const production = value.NODE_ENV === 'production';
        const allowIncomplete = !production && value.AVAILITY_ALLOW_INCOMPLETE_CONFIG !== 'false';
        const clientId = String(value.AVAILITY_CLIENT_ID || '');
        const clientSecret = String(value.AVAILITY_CLIENT_SECRET || '');
        const username = String(value.AVAILITY_SFTP_USERNAME || '');
        const placeholder = !clientId || clientId === 'sandbox' || !clientSecret || clientSecret === 'sandbox';
        if (!allowIncomplete && (placeholder || !username || (!password && !privateKey))) {
          return helpers.error('any.custom', {
            message:
              'Availity client id, client secret, SFTP username, and exactly one of password or private key are required. Set AVAILITY_ALLOW_INCOMPLETE_CONFIG=true only for local UI work.',
          });
        }
        return value;
      }),
    }),
  ],
  exports: [ConfigModule],
})
export class AvailityConfigModule {}
