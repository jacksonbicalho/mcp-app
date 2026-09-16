import { describe, expect, it } from '@jest/globals';
import { errorInfo } from './error-info';

describe('errorInfo', () => {
  it('extrai message e stack de uma instância de Error', () => {
    const error = new Error('algo quebrou');
    const result = errorInfo(error);
    expect(result.message).toBe('algo quebrou');
    expect(result.stack).toEqual(error.stack);
  });

  it('preserva a cause quando o Error foi criado com { cause }', () => {
    const cause = new Error('causa raiz');
    const error = new Error('falhou', { cause });
    const result = errorInfo(error);
    expect(result.message).toBe('falhou');
  });

  it('converte um valor não-Error (string) via String()', () => {
    const result = errorInfo('string lançada diretamente');
    expect(result).toEqual({ message: 'string lançada diretamente' });
  });

  it('converte um valor não-Error (objeto) via String()', () => {
    const result = errorInfo({ codigo: 42 });
    expect(result.message).toBe('[object Object]');
    expect(result.stack).toBeUndefined();
  });

  it('lida com null/undefined sem lançar', () => {
    expect(errorInfo(null).message).toBe('null');
    expect(errorInfo(undefined).message).toBe('undefined');
  });
});
