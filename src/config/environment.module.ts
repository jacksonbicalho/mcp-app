import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { EnvironmentService } from './environment.service';
import { ConfigMcpProvider } from './config.mcp-provider';

@Module({
  imports: [ConfigModule, AnalyzerModule],
  providers: [EnvironmentService, ConfigMcpProvider],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
