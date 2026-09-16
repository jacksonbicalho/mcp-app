import type { Config } from 'jest';
import coverageConfig from './coverage.config.json';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  detectOpenHandles: true,
};

// coverageThreshold só se aplica quando --coverage é passado (yarn test:cov);
// yarn test (sem cobertura) não precisa carregar/validar contra o ratchet.
if (process.argv.includes('--coverage')) {
  Object.assign(config, {
    collectCoverage: true,
    collectCoverageFrom: [
      'src/**/*.ts',
      '!src/**/*.spec.ts',
      '!src/**/*.module.ts',
      '!src/main.ts',
      '!src/mcp/mcp-tool-provider.decorator.ts',
      '!src/mcp/mcp-tool-provider.interface.ts',
    ],
    coverageDirectory: '<rootDir>/coverage',
    coverageReporters: ['json', 'json-summary', 'lcov', ['text', { file: 'coverage.txt' }]],
    coverageThreshold: coverageConfig.coverageThreshold,
    globalTeardown: '<rootDir>/scripts/coverage-teardown.ts',
  });
}

export default config;
