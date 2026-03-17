import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  APP_PORT: Joi.number().default(3000),
  APP_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  APP_NAME: Joi.string().default('erp-saas'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),

  S3_BUCKET: Joi.string().optional(),
  S3_ENDPOINT: Joi.string().optional(),
  S3_REGION: Joi.string().default('auto'),
  S3_ACCESS_KEY: Joi.string().optional(),
  S3_SECRET_KEY: Joi.string().optional(),

  ELASTICSEARCH_URL: Joi.string().default('http://localhost:9200'),

  ZATCA_ENV: Joi.string().valid('sandbox', 'production').default('sandbox'),
  ZATCA_CERT_PATH: Joi.string().optional(),
  ZATCA_PRIVATE_KEY_PATH: Joi.string().optional(),

  ETA_API_URL: Joi.string().optional(),
  ETA_CLIENT_ID: Joi.string().optional(),
  ETA_CLIENT_SECRET: Joi.string().optional(),

  SMTP_HOST: Joi.string().default('localhost'),
  SMTP_PORT: Joi.number().default(1025),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  SMTP_FROM: Joi.string().default('noreply@erp-platform.com'),

  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_MAX: Joi.number().default(100),
});
