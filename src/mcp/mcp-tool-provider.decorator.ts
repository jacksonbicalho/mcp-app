import { DiscoveryService } from '@nestjs/core';

export const McpToolProvider = DiscoveryService.createDecorator<void>();
