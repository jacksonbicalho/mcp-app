import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { McpService } from './mcp.service';
import { McpToolRegistryService } from './mcp-tool-registry.service';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { JiraModule } from '../jira/jira.module';
import { KibanaModule } from '../kibana/kibana.module';
import { GitLabModule } from '../gitlab/gitlab.module';

@Module({
  imports: [ConfigModule, DiscoveryModule, AnalyzerModule, JiraModule, KibanaModule, GitLabModule],
  providers: [McpService, McpToolRegistryService],
  exports: [McpService],
})
export class McpModule {}
