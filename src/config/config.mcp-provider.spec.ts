import { describe, expect, it, jest } from '@jest/globals';
import { ConfigMcpProvider } from './config.mcp-provider';
import type { EnvironmentService } from './environment.service';

interface FakeEnvironmentService {
  useEnvironment: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  list: jest.Mock<() => string[]>;
  current: jest.Mock<() => unknown>;
}

function makeEnvironmentService(): FakeEnvironmentService & EnvironmentService {
  const fake: FakeEnvironmentService = {
    useEnvironment: jest.fn(async () => ({ applied: [] })),
    list: jest.fn(() => ['development', 'staging']),
    current: jest.fn(() => ({ environment: 'development' })),
  };
  return fake as unknown as FakeEnvironmentService & EnvironmentService;
}

describe('ConfigMcpProvider', () => {
  it('expõe as 3 tools esperadas', () => {
    const provider = new ConfigMcpProvider(makeEnvironmentService());
    const names = provider.getToolDefinitions().map((t) => t.name);
    expect(names).toEqual(['use_environment', 'list_environments', 'get_current_environment']);
  });

  describe('callTool', () => {
    it('use_environment repassa environment e overrides', async () => {
      const environmentService = makeEnvironmentService();
      const provider = new ConfigMcpProvider(environmentService);

      await provider.callTool('use_environment', {
        environment: 'staging',
        overrides: { DB_HOST: 'outro-host' },
      });

      expect(environmentService.useEnvironment).toHaveBeenCalledWith('staging', { DB_HOST: 'outro-host' });
    });

    it('list_environments retorna { environments }', async () => {
      const environmentService = makeEnvironmentService();
      const provider = new ConfigMcpProvider(environmentService);

      await expect(provider.callTool('list_environments', {})).resolves.toEqual({ environments: ['development', 'staging'] });
    });

    it('get_current_environment delega pro service', async () => {
      const environmentService = makeEnvironmentService();
      const provider = new ConfigMcpProvider(environmentService);

      await expect(provider.callTool('get_current_environment', {})).resolves.toEqual({ environment: 'development' });
    });

    it('lança erro para tool desconhecida', async () => {
      const provider = new ConfigMcpProvider(makeEnvironmentService());
      await expect(provider.callTool('unknown_tool', {})).rejects.toThrow(/Unknown tool: unknown_tool/);
    });
  });
});
