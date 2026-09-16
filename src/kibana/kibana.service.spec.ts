import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import fetchMock from 'jest-fetch-mock';
import { KibanaService } from './kibana.service';

function makeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

const configured = (extra: Record<string, string> = {}) =>
  new KibanaService(makeConfigService({ KIBANA_BASE_URL: 'http://kibana.example:5601', ...extra }));

describe('KibanaService', () => {
  afterEach(() => {
    fetchMock.resetMocks();
  });

  it('lança erro claro quando KIBANA_BASE_URL não está configurado', async () => {
    const service = new KibanaService(makeConfigService({}));
    await expect(service.testConnection()).rejects.toThrow(/Defina KIBANA_BASE_URL/);
  });

  describe('testConnection', () => {
    it('mapeia version/overallState/name da resposta do /api/status', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          name: 'kibana-1',
          version: { number: '7.6.0' },
          status: { overall: { state: 'green' } },
        }),
      );
      const result = await configured().testConnection();
      expect(result).toEqual({
        version: '7.6.0',
        overallState: 'green',
        name: 'kibana-1',
        raw: {
          name: 'kibana-1',
          version: { number: '7.6.0' },
          status: { overall: { state: 'green' } },
        },
      });
    });

    it('usa Basic auth quando KIBANA_USERNAME/PASSWORD estão setados', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}));
      await configured({
        KIBANA_USERNAME: 'user',
        KIBANA_PASSWORD: 'pass',
      }).testConnection();

      const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
    });

    it('prioriza API Key sobre Basic quando ambos estão configurados', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}));
      await configured({
        KIBANA_API_KEY_ID: 'id',
        KIBANA_API_KEY_SECRET: 'secret',
        KIBANA_USERNAME: 'user',
        KIBANA_PASSWORD: 'pass',
      }).testConnection();

      const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe(`ApiKey ${Buffer.from('id:secret').toString('base64')}`);
    });

    it('traduz 401/403 em mensagem de acesso negado', async () => {
      fetchMock.mockResponseOnce('', { status: 403 });
      await expect(configured().testConnection()).rejects.toThrow(/acesso negado/);
    });

    it('traduz erros 5xx com status e statusText', async () => {
      fetchMock.mockResponseOnce('fora do ar', {
        status: 500,
        statusText: 'Internal Server Error',
      });
      await expect(configured().testConnection()).rejects.toThrow(/Kibana: 500 Internal Server Error/);
    });

    it('repassa o Error original quando não é DNS/timeout/conexão recusada', async () => {
      fetchMock.mockRejectOnce(new Error('algo bem específico'));
      await expect(configured().testConnection()).rejects.toThrow('algo bem específico');
    });

    it('lança erro quando a resposta não é JSON válido', async () => {
      fetchMock.mockResponseOnce('<html>erro</html>');
      await expect(configured().testConnection()).rejects.toThrow(/resposta não é JSON válido/);
    });

    it('traduz falha de DNS em mensagem amigável', async () => {
      fetchMock.mockRejectOnce(
        Object.assign(new Error('getaddrinfo ENOTFOUND kibana.internal'), {
          code: 'ENOTFOUND',
        }),
      );
      await expect(configured().testConnection()).rejects.toThrow(/falha de DNS\/rede/);
    });

    it('traduz timeout/conexão recusada em mensagem amigável', async () => {
      fetchMock.mockRejectOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
      await expect(configured().testConnection()).rejects.toThrow(/conexão recusada ou tempo esgotado/);
    });
  });

  describe('search', () => {
    it('usa o index pattern default quando nenhum override é passado', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ hits: [] }));
      await configured().search({ size: 1 });
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain(encodeURIComponent('app*/_search'));
    });

    it('usa o indexPattern do override quando informado', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ hits: [] }));
      await configured().search({ size: 1 }, 'custom*');
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain(encodeURIComponent('custom*/_search'));
    });

    it('rejeita indexPattern com caracteres não permitidos', async () => {
      await expect(configured().search({}, 'custom;drop')).rejects.toThrow(/caracteres não permitidos/);
    });

    it('traduz 401/403 no console proxy em mensagem específica', async () => {
      fetchMock.mockResponseOnce('', { status: 401 });
      await expect(configured().search({})).rejects.toThrow(/acesso negado no console proxy/);
    });

    it('lança erro quando o corpo da busca não é JSON', async () => {
      fetchMock.mockResponseOnce('nao-json');
      await expect(configured().search({})).rejects.toThrow(/corpo da busca não é JSON/);
    });

    it('traduz erros 5xx do console proxy com status e statusText', async () => {
      fetchMock.mockResponseOnce('fora do ar', {
        status: 502,
        statusText: 'Bad Gateway',
      });
      await expect(configured().search({})).rejects.toThrow(/Kibana console proxy: 502 Bad Gateway/);
    });

    it('traduz falha de rede na busca via wrapNetworkError', async () => {
      fetchMock.mockRejectOnce(
        Object.assign(new Error('getaddrinfo ENOTFOUND kibana.internal'), {
          code: 'ENOTFOUND',
        }),
      );
      await expect(configured().search({})).rejects.toThrow(/falha de DNS\/rede/);
    });
  });

  describe('getIndexPatternFields', () => {
    it('extrai e ordena os nomes de campos do índice', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'abc',
          type: 'index-pattern',
          attributes: {
            title: 'app*',
            timeFieldName: '@timestamp',
            fields: JSON.stringify({ zeta: {}, alpha: {} }),
          },
        }),
      );
      const result = await configured().getIndexPatternFields();
      expect(result.fieldNames).toEqual(['alpha', 'zeta']);
      expect(result.title).toBe('app*');
      expect(result.fieldNamesTruncated).toBe(false);
    });

    it('rejeita savedObjectId vazio', async () => {
      await expect(configured().getIndexPatternFields('   ')).rejects.toThrow(/savedObjectId não pode ser vazio/);
    });

    it('rejeita savedObjectId com caracteres não permitidos', async () => {
      await expect(configured().getIndexPatternFields('id com espaço')).rejects.toThrow(/caracteres não permitidos/);
    });

    it('trata fields inválido (JSON quebrado) como lista vazia', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'abc',
          attributes: { fields: '{invalido' },
        }),
      );
      const result = await configured().getIndexPatternFields('abc');
      expect(result.fieldNames).toEqual([]);
      expect(result.totalFieldNames).toBe(0);
    });

    it('trunca a lista quando excede o máximo de nomes de campo', async () => {
      const manyFields: Record<string, unknown> = {};
      for (let i = 0; i < 850; i++) {
        manyFields[`field_${String(i).padStart(4, '0')}`] = {};
      }
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'abc',
          attributes: { fields: JSON.stringify(manyFields) },
        }),
      );
      const result = await configured().getIndexPatternFields('abc');
      expect(result.totalFieldNames).toBe(850);
      expect(result.fieldNamesTruncated).toBe(true);
      expect(result.fieldNames).toHaveLength(800);
    });
  });
});
