import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { McpToolProvider as McpToolProviderDecorator } from './mcp-tool-provider.decorator';
import { McpToolDefinition, McpResourceDefinition, McpToolProvider } from './mcp-tool-provider.interface';

@Injectable()
export class McpToolRegistryService implements OnModuleInit {
  private toolOwners = new Map<string, McpToolProvider>();
  private resourcePrefixes: Array<{ prefix: string; provider: McpToolProvider }> = [];
  private allTools: McpToolDefinition[] = [];
  private allResources: McpResourceDefinition[] = [];

  constructor(private readonly discoveryService: DiscoveryService) {}

  onModuleInit() {
    const wrappers = this.discoveryService.getProviders({
      metadataKey: McpToolProviderDecorator.KEY,
    });

    for (const wrapper of wrappers) {
      const provider = wrapper.instance as McpToolProvider | undefined;
      if (!provider) continue;

      for (const tool of provider.getToolDefinitions()) {
        this.toolOwners.set(tool.name, provider);
        this.allTools.push(tool);
      }

      if (provider.getResourceDefinitions) {
        this.allResources.push(...provider.getResourceDefinitions());
      }

      if (provider.getResourceUriPrefixes) {
        for (const prefix of provider.getResourceUriPrefixes()) {
          this.resourcePrefixes.push({ prefix, provider });
        }
      }
    }

    // Prefixos mais longos primeiro, para evitar que um prefixo genérico
    // capture uma URI que pertence a um prefixo mais específico.
    this.resourcePrefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  getAllTools(): McpToolDefinition[] {
    return this.allTools;
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    const provider = this.toolOwners.get(name);
    if (!provider) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return provider.callTool(name, params);
  }

  getAllResources(): McpResourceDefinition[] {
    return this.allResources;
  }

  async readResource(uri: string): Promise<unknown> {
    const match = this.resourcePrefixes.find((entry) => uri.startsWith(entry.prefix));
    if (!match || !match.provider.readResource) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return match.provider.readResource(uri);
  }
}
