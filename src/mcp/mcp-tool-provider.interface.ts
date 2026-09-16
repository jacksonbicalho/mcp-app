export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpToolProvider {
  getToolDefinitions(): McpToolDefinition[];
  callTool(name: string, params: Record<string, unknown>): Promise<unknown>;
  // Só implementado por providers que expõem MCP resources.
  getResourceDefinitions?(): McpResourceDefinition[];
  getResourceUriPrefixes?(): string[];
  readResource?(uri: string): Promise<unknown>;
}
