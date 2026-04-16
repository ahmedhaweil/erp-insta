import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  // Swagger
  if (configService.get('app.env') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ERP SaaS API')
      .setDescription('Multi-tenant ERP SaaS Platform API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & Authorization')
      .addTag('tenants', 'Tenant Management')
      .addTag('accounting', 'Accounting & Finance')
      .addTag('inventory', 'Inventory & Warehouses')
      .addTag('sales', 'Sales & CRM')
      .addTag('purchasing', 'Purchasing & Vendors')
      .addTag('pos', 'Point of Sale')
      .addTag('compliance', 'ZATCA & ETA Compliance')
      .addTag('hr', 'HR & Payroll')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('app.port', 3000);
  await app.listen(port);
  console.log(`ERP SaaS API running on port ${port}`);
  console.log(`Environment: ${configService.get('app.env')}`);
  if (configService.get('app.env') !== 'production') {
    console.log(`Swagger: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
