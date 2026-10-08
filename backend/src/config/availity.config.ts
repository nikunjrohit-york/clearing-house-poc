import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { validateAvailityConfigOrThrow } from './availity-env';

export { validateAvailityConfigOrThrow } from './availity-env';

function requiredOutsideTest(name: string) {
  const missing = `Availity configuration missing. Set: ${name}. See backend/.env.example. Nothing is mocked — the app cannot start without live Availity credentials.`;
  return Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().allow('').optional(),
    otherwise: Joi.string().min(1).required().messages({
      'any.required': missing,
      'string.empty': missing,
      'string.min': missing,
    }),
  });
}

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
        AVAILITY_CLIENT_ID: requiredOutsideTest('AVAILITY_CLIENT_ID'),
        AVAILITY_CLIENT_SECRET: requiredOutsideTest('AVAILITY_CLIENT_SECRET'),
        AVAILITY_REALM: Joi.string().allow('').optional(),
        AVAILITY_SCOPE: Joi.string().allow('').default('hipaa'),
        AVAILITY_BASE_URL: Joi.string().uri().default('https://api.availity.com'),
        AVAILITY_TOKEN_URL: Joi.string().uri().default('https://api.availity.com/availity/v1/token'),
        AVAILITY_API_VERSION: Joi.string().default('v1'),
        AVAILITY_SUBMITTER_ID: requiredOutsideTest('AVAILITY_SUBMITTER_ID'),
        AVAILITY_RECEIVER_ID: requiredOutsideTest('AVAILITY_RECEIVER_ID'),
        AVAILITY_USAGE_INDICATOR: Joi.string().valid('T', 'P').default('T'),
        AVAILITY_SFTP_HOST: Joi.string().when('NODE_ENV', {
          is: 'test',
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().default('qa-files.availity.com'),
        }),
        AVAILITY_SFTP_PORT: Joi.number().port().default(22),
        AVAILITY_SFTP_USERNAME: requiredOutsideTest('AVAILITY_SFTP_USERNAME'),
        AVAILITY_SFTP_PASSWORD: Joi.string().allow('').optional(),
        AVAILITY_SFTP_PRIVATE_KEY_PATH: Joi.string().allow('').optional(),
        AVAILITY_SFTP_SEND_PATH: Joi.string().default('/SendFiles'),
        AVAILITY_SFTP_RECEIVE_PATH: Joi.string().default('/ReceiveFiles'),
        AVAILITY_SFTP_INBOUND_PATH: Joi.string().default('/ReceiveFiles'),
        AVAILITY_SFTP_OUTBOUND_PATH: Joi.string().default('/SendFiles'),
        AVAILITY_ALLOW_ENV_MISMATCH: Joi.string().valid('true', 'false').default('false'),
        AVAILITY_CONTROL_NUMBER_STORE: Joi.string().allow('').optional(),
        AVAILITY_COVERAGE_POLL_ATTEMPTS: Joi.number().integer().min(1).default(15),
        AVAILITY_COVERAGE_POLL_INTERVAL_MS: Joi.number().integer().min(0).default(2000),
        PORT: Joi.number().port().default(3000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('debug'),
        OPTUM_CLIENT_ID: Joi.string().allow('').optional(),
        OPTUM_CLIENT_SECRET: Joi.string().allow('').optional(),
        OPTUM_BASE_URL: Joi.string().uri().optional(),
        OPTUM_TOKEN_URL: Joi.string().uri().optional(),
        OPTUM_TRADING_PARTNER_ID: Joi.string().allow('').optional(),
        OPTUM_277_REPORT_ID: Joi.string().allow('').optional(),
        OPTUM_835_REPORT_ID: Joi.string().allow('').optional(),
      }).custom((value, helpers) => {
        try {
          validateAvailityConfigOrThrow(value as NodeJS.ProcessEnv);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Availity configuration missing';
          return helpers.error('any.custom', { message });
        }
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
        if (value.NODE_ENV === 'test') {
          return value;
        }
        const password = String(value.AVAILITY_SFTP_PASSWORD || '');
        const privateKey = String(value.AVAILITY_SFTP_PRIVATE_KEY_PATH || '');
        if (password && privateKey) {
          return helpers.error('any.custom', {
            message: 'Set AVAILITY_SFTP_PASSWORD or AVAILITY_SFTP_PRIVATE_KEY_PATH, not both',
          });
        }
        if (!password && !privateKey) {
          return helpers.error('any.custom', {
            message: 'Set AVAILITY_SFTP_PASSWORD or AVAILITY_SFTP_PRIVATE_KEY_PATH',
          });
        }
        return value;
      }),
    }),
  ],
  exports: [ConfigModule],
})
export class AvailityConfigModule {}
