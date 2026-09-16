import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitLabService } from './gitlab.service';
import { GitLabMcpProvider } from './gitlab.mcp-provider';

@Module({
  imports: [ConfigModule],
  providers: [GitLabService, GitLabMcpProvider],
  exports: [GitLabService],
})
export class GitLabModule {}
