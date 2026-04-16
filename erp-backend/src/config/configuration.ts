export default () => ({
  app: {
    port: parseInt(process.env.APP_PORT || '3000', 10),
    env: process.env.APP_ENV || 'development',
    name: process.env.APP_NAME || 'erp-saas',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'erp_saas',
    user: process.env.DB_USER || 'erp_admin',
    password: process.env.DB_PASSWORD || 'erp_secret',
    ssl: process.env.DB_SSL === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret',
    expiry: process.env.JWT_EXPIRY || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  s3: {
    bucket: process.env.S3_BUCKET || 'erp-files',
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
  },
  elasticsearch: {
    url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  },
  zatca: {
    env: process.env.ZATCA_ENV || 'sandbox',
    certPath: process.env.ZATCA_CERT_PATH,
    privateKeyPath: process.env.ZATCA_PRIVATE_KEY_PATH,
  },
  eta: {
    apiUrl: process.env.ETA_API_URL,
    clientId: process.env.ETA_CLIENT_ID,
    clientSecret: process.env.ETA_CLIENT_SECRET,
  },
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '1025', 10),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM || 'noreply@erp-platform.com',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
});
