import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { DatabaseMcpProvider } from './database.mcp-provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [DatabaseService, DatabaseMcpProvider],
  exports: [DatabaseService],
})
export class DatabaseModule {}
