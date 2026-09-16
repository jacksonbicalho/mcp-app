import 'reflect-metadata';
import './config/load-environments';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const mcpService = app.get(McpService);
  await mcpService.start();

  logger.log('MCP server started successfully and waiting for requests...');

  // O servidor MCP precisa manter o processo vivo
  // O StdioServerTransport mantém o processo rodando automaticamente
  // Não precisamos fazer nada aqui, apenas aguardar requisições

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.log('Received SIGINT, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.log('Received SIGTERM, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  // Usar console.error apenas como fallback antes do logger estar disponível
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
