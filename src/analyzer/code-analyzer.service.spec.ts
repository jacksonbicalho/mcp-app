import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeAnalyzerService } from './code-analyzer.service';

function makeConfigService(appPath: string): ConfigService {
  return {
    get: jest.fn((_key: string, defaultValue?: unknown) => appPath || defaultValue),
  } as unknown as ConfigService;
}

describe('CodeAnalyzerService', () => {
  let appPath: string;
  let service: CodeAnalyzerService;

  beforeAll(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-'));

    fs.writeFileSync(path.join(appPath, 'index.php'), "<?php echo 'hi'; ?>");
    fs.writeFileSync(path.join(appPath, 'composer.json'), '{}');
    fs.writeFileSync(path.join(appPath, '.env'), 'APP_ENV=local');
    fs.writeFileSync(path.join(appPath, '.hidden-file'), 'ignorado');

    fs.mkdirSync(path.join(appPath, 'src'));
    fs.writeFileSync(
      path.join(appPath, 'src', 'Controller.php'),
      [
        '<?php',
        'class UserController extends BaseController implements Loggable, Cacheable {',
        '  private $db;',
        '  public $name;',
        '  public function index() {',
        "    return $this->db->query('SELECT * FROM users');",
        '  }',
        '  private function helper() {}',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(appPath, 'src', 'Model.php'),
      [
        '<?php',
        '// procura por padrão de URL de exemplo abaixo',
        "$conn = pg_connect('host=localhost');",
        "$result = pg_query($conn, 'SELECT * FROM produtos');",
        '// veja https://exemplo.dev/docs para mais informações',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(appPath, 'src', 'empty.php'), '<?php // sem classe aqui');

    fs.mkdirSync(path.join(appPath, 'src', 'nested'));
    fs.writeFileSync(path.join(appPath, 'src', 'nested', 'Deep.php'), '<?php // usado só pra testar o corte de maxDepth');

    fs.mkdirSync(path.join(appPath, 'node_modules'));
    fs.writeFileSync(path.join(appPath, 'node_modules', 'ignored.php'), 'class NuncaAparece { public function x() {} }');

    // Arquivo grande o suficiente pra disparar o limite de 1MB de readFile
    // e o de 512KB de searchInFiles/getDatabaseReferences
    fs.writeFileSync(path.join(appPath, 'big.php'), 'x'.repeat(1200 * 1024));

    service = new CodeAnalyzerService(makeConfigService(appPath));
  });

  afterAll(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it('getAppPath retorna o APP_PATH configurado', () => {
    expect(service.getAppPath()).toBe(appPath);
  });

  it('getAppPath cai para /projetos/app quando APP_PATH configurado é uma string vazia', () => {
    const emptyConfigService = {
      get: jest.fn(() => ''),
    } as unknown as ConfigService;
    const svc = new CodeAnalyzerService(emptyConfigService);
    expect(svc.getAppPath()).toBe('/projetos/app');
  });

  describe('listDirectory', () => {
    it('usa a raiz do appPath quando chamado sem argumento', async () => {
      const entries = await service.listDirectory();
      expect(entries.map((e) => e.name)).toContain('index.php');
    });

    it('lista arquivos e diretórios da raiz, ignorando dotfiles', async () => {
      const entries = await service.listDirectory('');
      const names = entries.map((e) => e.name);

      expect(names).toContain('index.php');
      expect(names).toContain('src');
      expect(names).not.toContain('.env');
      expect(names).not.toContain('.hidden-file');
    });

    it('lança erro para diretório inexistente', async () => {
      await expect(service.listDirectory('nao-existe')).rejects.toThrow(/Directory not found/);
    });

    it('ordena diretórios antes de arquivos, depois por nome', async () => {
      const entries = await service.listDirectory('');
      const firstFileIndex = entries.findIndex((e) => e.type === 'file');
      const lastDirIndex = entries.map((e) => e.type).lastIndexOf('directory');
      if (firstFileIndex !== -1 && lastDirIndex !== -1) {
        expect(lastDirIndex).toBeLessThan(firstFileIndex);
      }
    });
  });

  describe('readFile', () => {
    it('lê o conteúdo, tamanho e extensão de um arquivo existente', async () => {
      const result = await service.readFile('index.php');
      expect(result.content).toContain("echo 'hi'");
      expect(result.extension).toBe('.php');
      expect(result.size).toBeGreaterThan(0);
    });

    it('lança erro para arquivo inexistente', async () => {
      await expect(service.readFile('nao-existe.php')).rejects.toThrow(/File not found/);
    });

    it('lança erro ao tentar ler um diretório', async () => {
      await expect(service.readFile('src')).rejects.toThrow(/Path is a directory/);
    });

    it('lança erro para arquivo maior que 1MB', async () => {
      await expect(service.readFile('big.php')).rejects.toThrow(/File too large/);
    });
  });

  describe('searchFiles', () => {
    it('encontra arquivos por padrão no nome, ignorando node_modules', async () => {
      const results = await service.searchFiles('controller');
      expect(results.map((r) => r.name)).toEqual(['Controller.php']);
    });

    it('filtra por extensão quando informado', async () => {
      const results = await service.searchFiles('index', ['.json']);
      expect(results).toEqual([]);
    });
  });

  describe('searchInFiles', () => {
    it('encontra linhas que contêm o termo buscado', async () => {
      const results = await service.searchInFiles('select', ['.php']);
      const files = results.map((r) => r.file);
      expect(files).toContain(path.join('src', 'Controller.php'));
      expect(files).toContain(path.join('src', 'Model.php'));
    });

    it('pula arquivos maiores que 512KB', async () => {
      const results = await service.searchInFiles('x', ['.php']);
      expect(results.some((r) => r.file === 'big.php')).toBe(false);
    });

    it('usa as extensões default (.php, .js) quando não informadas', async () => {
      const results = await service.searchInFiles('select');
      expect(results.some((r) => r.file === path.join('src', 'Model.php'))).toBe(true);
    });
  });

  describe('getCodeStats', () => {
    it('conta arquivos por extensão e ignora node_modules', async () => {
      const stats = await service.getCodeStats();
      expect(stats.totalFiles).toBeGreaterThan(0);
      expect(stats.byExtension['.php']).toBeGreaterThanOrEqual(3);
      expect(stats.largestFiles[0].path).toBe('big.php');
    });

    it("agrupa arquivos sem extensão em 'no-extension'", async () => {
      fs.writeFileSync(path.join(appPath, 'SemExtensao'), 'conteúdo');
      const stats = await service.getCodeStats();
      expect(stats.byExtension['no-extension']).toBeGreaterThanOrEqual(1);
      fs.rmSync(path.join(appPath, 'SemExtensao'));
    });
  });

  describe('getDirectoryStructure', () => {
    it('usa relativePath/maxDepth default quando chamado sem argumentos', async () => {
      const structure = await service.getDirectoryStructure();
      expect(structure.type).toBe('directory');
    });

    it('monta a árvore respeitando maxDepth', async () => {
      const structure = await service.getDirectoryStructure('', 1);
      expect(structure.type).toBe('directory');
      const srcNode = structure.children.find((c) => c.name === 'src');
      expect(srcNode).toBeDefined();
    });

    it('no limite de maxDepth, lista o subdiretório sem descer nele', async () => {
      const structure = await service.getDirectoryStructure('', 1);
      const srcNode = structure.children.find((c) => c.name === 'src') as {
        children: Array<{ name: string; type: string; children?: unknown }>;
      };
      const nestedNode = srcNode.children.find((c) => c.name === 'nested');
      expect(nestedNode?.type).toBe('directory');
      expect(nestedNode?.children).toBeUndefined();
    });

    it('lança erro para diretório inexistente', async () => {
      await expect(service.getDirectoryStructure('nao-existe')).rejects.toThrow(/Directory not found/);
    });
  });

  describe('analyzePHPFile', () => {
    it('extrai classe, extends, implements, métodos e propriedades', async () => {
      const info = await service.analyzePHPFile(path.join('src', 'Controller.php'));
      expect(info?.name).toBe('UserController');
      expect(info?.extends).toBe('BaseController');
      expect(info?.implements).toEqual(['Loggable', 'Cacheable']);
      expect(info?.methods).toEqual(['index', 'helper']);
      expect(info?.properties).toEqual(['db', 'name']);
    });

    it('retorna null quando não há classe no arquivo', async () => {
      const info = await service.analyzePHPFile(path.join('src', 'empty.php'));
      expect(info).toBeNull();
    });
  });

  describe('getSystemOverview', () => {
    it('detecta arquivos de config e entry points na raiz', async () => {
      const overview = await service.getSystemOverview();
      expect(overview.path).toBe(appPath);
      expect(overview.entryPoints).toContain('index.php');
      expect(overview.configFiles).toContain('composer.json');
      expect(overview.mainDirectories).toContain('src');
    });

    it.each([
      ['yii', 'Yii Framework'],
      ['protected', 'Yii Framework'],
      ['artisan', 'Laravel'],
      ['symfony.lock', 'Symfony'],
    ])('detecta o framework %s pelo marcador de arquivo', async (marker, expected) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-'));
      fs.writeFileSync(path.join(dir, marker), '');
      const svc = new CodeAnalyzerService(makeConfigService(dir));

      const overview = await svc.getSystemOverview();
      expect(overview.framework).toBe(expected);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('getDatabaseReferences', () => {
    it('encontra padrões de acesso a banco em arquivos .php', async () => {
      const refs = await service.getDatabaseReferences();
      const files = refs.map((r) => r.file);
      expect(files).toContain(path.join('src', 'Model.php'));
    });
  });

  describe('searchUrlInFiles', () => {
    it('encontra a URL em arquivos de texto e reporta linha/contexto', async () => {
      const result = await service.searchUrlInFiles('exemplo.dev');
      expect(result.filesSearched).toBeGreaterThan(0);
      expect(result.results.some((r) => r.file === path.join('src', 'Model.php'))).toBe(true);
    });

    it('escapa caracteres especiais de regex na URL', async () => {
      const result = await service.searchUrlInFiles('https://exemplo.dev/docs');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('retorna vazio quando a URL não aparece em nenhum arquivo', async () => {
      const result = await service.searchUrlInFiles('url-que-nao-existe-em-lugar-nenhum');
      expect(result.results).toEqual([]);
    });

    it('para de buscar ao atingir 1000 resultados', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-cap-'));
      const manyLines = Array.from({ length: 1001 }, (_, i) => `linha ${i} com exemplo.dev aqui`).join('\n');
      fs.writeFileSync(path.join(dir, 'muitas-linhas.txt'), manyLines);
      const svc = new CodeAnalyzerService(makeConfigService(dir));

      const result = await svc.searchUrlInFiles('exemplo.dev');
      expect(result.results.length).toBeLessThanOrEqual(1000);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
