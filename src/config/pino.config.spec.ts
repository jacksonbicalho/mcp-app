import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Options as PinoHttpOptions } from 'pino-http';
import { parseLoggerConfig } from './pino.config';

const originalEnv = { ...process.env };
const originalIsTTY = process.stdin.isTTY;
let tmpLogDir: string;
const openStreams: fs.WriteStream[] = [];

function setStdinIsTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, 'isTTY', {
    value,
    configurable: true,
  });
}

function trackStream(pinoHttp: PinoHttpOptions | [PinoHttpOptions, NodeJS.WritableStream]) {
  if (Array.isArray(pinoHttp)) {
    const [, stream] = pinoHttp;
    if (stream !== process.stderr && stream !== process.stdout) {
      openStreams.push(stream as fs.WriteStream);
    }
  }
  return pinoHttp;
}

describe('parseLoggerConfig', () => {
  beforeAll(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pino-config-'));
  });

  afterAll(async () => {
    // Espera cada fileStream terminar de abrir/fechar antes de apagar o
    // diretório, senão o open() assíncrono do fs pode falhar depois que o
    // diretório já sumiu (erro não tratado atribuído a um teste seguinte).
    await Promise.all(
      openStreams.map(
        (stream) =>
          new Promise<void>((resolve) => {
            // multistream() devolve um objeto que não é um fs.WriteStream de
            // verdade (sem .on/.destroy) — só espera fechar quando for um.
            if (stream.destroyed || typeof stream.on !== 'function' || typeof stream.destroy !== 'function') {
              return resolve();
            }
            stream.on('close', () => resolve());
            stream.destroy();
          }),
      ),
    );
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.LOG_DIR = tmpLogDir;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    setStdinIsTTY(originalIsTTY);
  });

  it("usa 'info' como default de nível quando LOGGER_LEVEL não é setado", () => {
    delete process.env.LOGGER_LEVEL;
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const config = (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as PinoHttpOptions;
    expect(config?.level).toBe('info');
  });

  it("cai para 'info' quando LOGGER_LEVEL é um valor desconhecido", () => {
    process.env.LOGGER_LEVEL = 'nivel-invalido';
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const config = (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as PinoHttpOptions;
    expect(config?.level).toBe('info');
  });

  it('aceita um nível válido (debug)', () => {
    process.env.LOGGER_LEVEL = 'debug';
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const config = (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as PinoHttpOptions;
    expect(config?.level).toBe('debug');
  });

  it('target=file fora de development retorna [config, fileStream]', () => {
    process.env.LOGGER_TARGET = 'file';
    process.env.NODE_ENV = 'production';
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    expect(Array.isArray(pinoHttp)).toBe(true);
    const [, stream] = pinoHttp as [PinoHttpOptions, NodeJS.WritableStream];
    expect(typeof stream.write).toBe('function');
  });

  it('target=file em development e não-mcp usa multistream (arquivo + pino-pretty)', () => {
    process.env.LOGGER_TARGET = 'file';
    process.env.NODE_ENV = 'development';
    setStdinIsTTY(true);
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    expect(Array.isArray(pinoHttp)).toBe(true);
  });

  it('target=console e servidor MCP (stdin não é TTY) usa stderr', () => {
    process.env.LOGGER_TARGET = 'console';
    setStdinIsTTY(false);
    const { pinoHttp } = parseLoggerConfig();
    const [, stream] = pinoHttp as [PinoHttpOptions, NodeJS.WritableStream];
    expect(stream).toBe(process.stderr);
  });

  it('target=console em development usa transport e não retorna stream', () => {
    process.env.LOGGER_TARGET = 'console';
    process.env.NODE_ENV = 'development';
    setStdinIsTTY(true);
    const { pinoHttp } = parseLoggerConfig();
    expect(Array.isArray(pinoHttp)).toBe(false);
    const transport = (pinoHttp as PinoHttpOptions).transport as unknown as {
      options: { destination: unknown };
    };
    expect(transport).toBeDefined();
    expect(transport.options.destination).toBe(process.stdout);
  });

  it('target=console em development e servidor MCP usa stderr como destination do transport', () => {
    process.env.LOGGER_TARGET = 'console';
    process.env.NODE_ENV = 'development';
    setStdinIsTTY(false); // !isTTY força isMcpServer = true
    const { pinoHttp } = parseLoggerConfig();
    const transport = (pinoHttp as PinoHttpOptions).transport as unknown as {
      options: { destination: unknown };
    };
    expect(transport.options.destination).toBe(process.stderr);
  });

  it('target desconhecido cai no default (arquivo)', () => {
    process.env.LOGGER_TARGET = 'algo-invalido';
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    expect(Array.isArray(pinoHttp)).toBe(true);
  });

  it('usa LOG_FILE_PATH quando informado, em vez de LOG_DIR/app.log', () => {
    const customPath = path.join(tmpLogDir, 'custom.log');
    process.env.LOG_FILE_PATH = customPath;
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const [, stream] = pinoHttp as [PinoHttpOptions, fs.WriteStream];
    expect(stream.path).toBe(customPath);
  });

  it('mescla o override no resultado final', () => {
    const result = parseLoggerConfig({ renameContext: 'reqId' });
    trackStream(result.pinoHttp as never);
    expect(result.renameContext).toBe('reqId');
  });

  it('cria o diretório de logs quando ele ainda não existe', () => {
    const nestedDir = path.join(tmpLogDir, 'ainda-nao-existe', 'logs');
    process.env.LOG_DIR = nestedDir;
    expect(fs.existsSync(nestedDir)).toBe(false);

    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);

    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  it('formatters.level e timestamp produzem o formato esperado', () => {
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const config = (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as PinoHttpOptions;

    expect(config.formatters?.level?.('info', 30)).toEqual({ severity: 'info' });
    const timestampFn = config.timestamp as unknown as () => string;
    expect(timestampFn()).toMatch(/^,"@timestamp":"/);
  });

  it('o write() do fileStream delega corretamente pras 3 formas de chamada', async () => {
    process.env.LOGGER_TARGET = 'file';
    process.env.NODE_ENV = 'production';
    const { pinoHttp } = parseLoggerConfig();
    trackStream(pinoHttp as never);
    const [, stream] = pinoHttp as [PinoHttpOptions, fs.WriteStream];

    await new Promise<void>((resolve) => {
      // Forma 1: write(chunk) — sem encoding nem callback
      expect(typeof stream.write('linha 1\n')).toBe('boolean');
      // Forma 2: write(chunk, callback)
      stream.write('linha 2\n', () => {
        // Forma 3: write(chunk, encoding, callback)
        stream.write('linha 3\n', 'utf-8', () => resolve());
      });
    });
  });
});
