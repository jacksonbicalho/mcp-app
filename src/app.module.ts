import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './database/database.module';
import { EnvironmentModule } from './config/environment.module';
import { McpModule } from './mcp/mcp.module';
import { config as pinoConfig } from './config/pino.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Absolute path from dist/ so MCP works even when process.cwd() is not the repo root.
      // Existing process.env (e.g. Cursor MCP "env") overrides .env defaults — do not set override: true.
      envFilePath: join(__dirname, '..', '.env'),
    }),
    LoggerModule.forRootAsync({
      useFactory() {
        return pinoConfig;
      },
    }),
    DatabaseModule,
    EnvironmentModule,
    McpModule,
  ],
})
export class AppModule {}
