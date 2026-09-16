import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CodeAnalyzerService } from './code-analyzer.service';
import { AnalyzerMcpProvider } from './analyzer.mcp-provider';

@Module({
  imports: [ConfigModule],
  providers: [CodeAnalyzerService, AnalyzerMcpProvider],
  exports: [CodeAnalyzerService],
})
export class AnalyzerModule {}
