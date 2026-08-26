import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Preserves the raw request body so the Paystack webhook handler can
    // verify the HMAC signature before trusting the parsed JSON.
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // Swagger UI serves its own inline scripts/styles, which a strict default
  // CSP blocks — only relax it where docs are actually exposed.
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGIN')!
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('OpenPool API')
      .setDescription(
        'Non-custodial financial pooling & collection platform — organizations, events, budget allocation, invoices/permanent links, and Paystack-backed payments.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
void bootstrap();
