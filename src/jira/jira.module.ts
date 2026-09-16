import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JiraService } from './jira.service';
import { JiraMcpProvider } from './jira.mcp-provider';

@Module({
  imports: [ConfigModule],
  providers: [JiraService, JiraMcpProvider],
  exports: [JiraService],
})
export class JiraModule {}
