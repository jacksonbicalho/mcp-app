import { Params } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import type { LevelWithSilent } from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import { multistream } from 'pino-multi-stream';
import pinoPretty from 'pino-pretty';

const PINO_LEVELS: readonly LevelWithSilent[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function parseLogLevel(value: string): LevelWithSilent {
  return (PINO_LEVELS as readonly string[]).includes(value) ? (value as LevelWithSilent) : 'info';
}

export function parseLoggerConfig(override?: Params): Params {
  const {
    LOGGER_LEVEL: rawLoggerLevel = 'info',
    LOGGER_TARGET: envLoggerTarget = 'file',
    LOG_FILE_PATH: envLogFilePath,
    LOG_DIR: envLogDir,
  } = process.env;

  const envLoggerLevel = parseLogLevel(rawLoggerLevel);

  // LOG_DIR tem prioridade sobre process.cwd() — permite configurar de fora
  // onde os logs deste binário caem (ex.: no "env" da config do cliente MCP).
  const logsDir = envLogDir ? path.resolve(envLogDir) : path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Definir caminho do arquivo de log
  const logFilePath = envLogFilePath || path.join(logsDir, 'app.log');

  const pinoConfig: PinoHttpOptions = {
    enabled: process.env.NODE_ENV !== 'test',
    formatters: {
      level(label: string) {
        return { severity: label };
      },
    },
    messageKey: 'message',
    level: envLoggerLevel,
    autoLogging: false,
    timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
  };

  let stream: NodeJS.WritableStream | undefined;

  // Detectar se estamos rodando como servidor MCP (via stdio)
  // Quando executado pelo Cursor via node, pode não detectar corretamente
  // Forçar modo MCP se não estiver em modo interativo ou se a variável estiver setada
  const isMcpServer = !process.stdin.isTTY || process.env.MCP_SERVER === 'true' || process.env.NODE_ENV !== 'development';

  // Configurar stream baseado no target
  if (envLoggerTarget === 'file') {
    // Por padrão, escrever em arquivo
    // Usar autoClose: false para manter o stream aberto
    const fileStream = fs.createWriteStream(logFilePath, {
      flags: 'a',
      autoClose: false,
    });

    // Forçar flush após cada escrita para garantir que logs apareçam imediatamente
    const originalWrite = fileStream.write.bind(fileStream);
    const loggedWrite = (
      chunk: string | Buffer,
      encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void,
    ): boolean => {
      const result =
        typeof encoding === 'function'
          ? originalWrite(chunk, encoding)
          : encoding !== undefined
            ? originalWrite(chunk, encoding, callback)
            : originalWrite(chunk, callback);
      if (result) {
        fileStream.uncork?.();
      }
      return result;
    };
    fileStream.write = loggedWrite as typeof fileStream.write;

    if (process.env.NODE_ENV === 'development' && !isMcpServer) {
      // Em desenvolvimento E não é servidor MCP: arquivo + stderr formatado (pino-pretty)
      // Usar stderr para não interferir com stdout do MCP
      stream = multistream([
        {
          level: envLoggerLevel,
          stream: pinoPretty({
            levelKey: 'severity',
            colorize: true,
            singleLine: true,
            messageKey: 'message',
            timestampKey: '@timestamp',
            destination: process.stderr, // Usar stderr, não stdout
          }),
        },
        {
          level: envLoggerLevel,
          stream: fileStream,
        },
      ]);
    } else {
      // Em produção ou servidor MCP: apenas arquivo (nunca stdout)
      stream = fileStream;
    }
  } else if (envLoggerTarget === 'console') {
    // Apenas console - usar stderr se for servidor MCP
    if (isMcpServer) {
      stream = process.stderr; // Servidor MCP: usar stderr
    } else {
      stream = process.stdout; // Não é servidor MCP: usar stdout
    }
    if (process.env.NODE_ENV === 'development') {
      pinoConfig.transport = {
        target: 'pino-pretty',
        options: {
          levelKey: 'severity',
          colorize: true,
          singleLine: true,
          messageKey: 'message',
          timestampKey: '@timestamp',
          destination: isMcpServer ? process.stderr : process.stdout,
        },
      };
      stream = undefined; // Quando usar transport, não precisa de stream
    }
  } else {
    // Default: file
    const fileStream = fs.createWriteStream(logFilePath, {
      flags: 'a',
      autoClose: false,
    });
    stream = fileStream;
  }

  // Para ApplicationContext, não usamos pinoHttp
  // Retornar configuração direta do Pino
  return {
    pinoHttp: stream ? [pinoConfig, stream] : pinoConfig,
    ...override,
  };
}

export const config = parseLoggerConfig();
