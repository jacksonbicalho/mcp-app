import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KibanaService } from './kibana.service';
import { KibanaMcpProvider } from './kibana.mcp-provider';

@Module({
  imports: [ConfigModule],
  providers: [KibanaService, KibanaMcpProvider],
  exports: [KibanaService],
})
export class KibanaModule {}
