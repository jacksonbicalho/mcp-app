import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  size?: number;
}

export interface DirectoryStructure {
  name: string;
  path: string;
  type: 'directory';
  children: (FileInfo | DirectoryStructure)[];
  fileCount: number;
  directoryCount: number;
}

export interface CodeStats {
  totalFiles: number;
  totalDirectories: number;
  byExtension: Record<string, number>;
  largestFiles: { path: string; size: number }[];
}

export interface PHPClassInfo {
  name: string;
  file: string;
  extends?: string;
  implements?: string[];
  methods: string[];
  properties: string[];
}

export interface ConfigInfo {
  databases: { name: string; host: string; database: string }[];
  environment: Record<string, string>;
  routes: { path: string; handler: string }[];
}

@Injectable()
export class CodeAnalyzerService {
  constructor(private configService: ConfigService) {}

  private get appPath(): string {
    return this.configService.get<string>('APP_PATH', '/projetos/app') || '/projetos/app';
  }

  getAppPath(): string {
    return this.appPath;
  }

  async listDirectory(relativePath: string = ''): Promise<FileInfo[]> {
    const fullPath = path.join(this.appPath, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${fullPath}`);
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const entryPath = path.join(relativePath, entry.name);
        const stats = fs.statSync(path.join(fullPath, entry.name));

        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          extension: entry.isFile() ? path.extname(entry.name) : undefined,
          size: entry.isFile() ? stats.size : undefined,
        } as FileInfo;
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  async readFile(relativePath: string): Promise<{ content: string; size: number; extension: string }> {
    const fullPath = path.join(this.appPath, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${fullPath}`);
    }

    // Limit file size to prevent memory issues
    const maxSize = 1024 * 1024; // 1MB
    if (stats.size > maxSize) {
      throw new Error(`File too large (${stats.size} bytes). Maximum allowed: ${maxSize} bytes`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    return {
      content,
      size: stats.size,
      extension: path.extname(fullPath),
    };
  }

  async searchFiles(pattern: string, extensions?: string[]): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const maxResults = 100;

    const searchDir = (dir: string, relativePath: string = '') => {
      if (results.length >= maxResults) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.name.startsWith('.')) continue;

          // Skip common non-source directories
          if (entry.isDirectory() && ['node_modules', 'vendor', 'logs', 'cache', 'tmp'].includes(entry.name)) {
            continue;
          }

          const entryRelativePath = path.join(relativePath, entry.name);
          const entryFullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            searchDir(entryFullPath, entryRelativePath);
          } else {
            const ext = path.extname(entry.name);

            // Check extension filter
            if (extensions && extensions.length > 0 && !extensions.includes(ext)) {
              continue;
            }

            // Check pattern match
            if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
              const stats = fs.statSync(entryFullPath);
              results.push({
                name: entry.name,
                path: entryRelativePath,
                type: 'file',
                extension: ext,
                size: stats.size,
              });
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    searchDir(this.appPath);
    return results;
  }

  async searchInFiles(searchTerm: string, extensions: string[] = ['.php', '.js']): Promise<{ file: string; line: number; content: string }[]> {
    const results: { file: string; line: number; content: string }[] = [];
    const maxResults = 50;

    const searchDir = (dir: string, relativePath: string = '') => {
      if (results.length >= maxResults) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.name.startsWith('.')) continue;

          if (entry.isDirectory() && ['node_modules', 'vendor', 'logs', 'cache', 'tmp'].includes(entry.name)) {
            continue;
          }

          const entryRelativePath = path.join(relativePath, entry.name);
          const entryFullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            searchDir(entryFullPath, entryRelativePath);
          } else {
            const ext = path.extname(entry.name);
            if (!extensions.includes(ext)) continue;

            try {
              const stats = fs.statSync(entryFullPath);
              if (stats.size > 512 * 1024) continue; // Skip files > 512KB

              const content = fs.readFileSync(entryFullPath, 'utf-8');
              const lines = content.split('\n');

              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (lines[i].toLowerCase().includes(searchTerm.toLowerCase())) {
                  results.push({
                    file: entryRelativePath,
                    line: i + 1,
                    content: lines[i].trim().substring(0, 200),
                  });
                }
              }
            } catch {
              // Skip files we can't read
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    searchDir(this.appPath);
    return results;
  }

  async getCodeStats(): Promise<CodeStats> {
    const byExtension: Record<string, number> = {};
    const largestFiles: { path: string; size: number }[] = [];
    let totalFiles = 0;
    let totalDirectories = 0;

    const processDir = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;

          const entryRelativePath = path.join(relativePath, entry.name);
          const entryFullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!['node_modules', 'vendor', 'logs', 'cache', 'tmp'].includes(entry.name)) {
              totalDirectories++;
              processDir(entryFullPath, entryRelativePath);
            }
          } else {
            totalFiles++;
            const ext = path.extname(entry.name) || 'no-extension';
            byExtension[ext] = (byExtension[ext] || 0) + 1;

            try {
              const stats = fs.statSync(entryFullPath);
              largestFiles.push({ path: entryRelativePath, size: stats.size });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    processDir(this.appPath);

    // Sort and keep top 20 largest files
    largestFiles.sort((a, b) => b.size - a.size);

    return {
      totalFiles,
      totalDirectories,
      byExtension,
      largestFiles: largestFiles.slice(0, 20),
    };
  }

  async getDirectoryStructure(relativePath: string = '', maxDepth: number = 2): Promise<DirectoryStructure> {
    const fullPath = path.join(this.appPath, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${fullPath}`);
    }

    const buildStructure = (dir: string, relPath: string, depth: number): DirectoryStructure => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const children: (FileInfo | DirectoryStructure)[] = [];
      let fileCount = 0;
      let directoryCount = 0;

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', 'vendor'].includes(entry.name)) continue;

        const entryRelPath = path.join(relPath, entry.name);
        const entryFullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          directoryCount++;
          if (depth < maxDepth) {
            const subStructure = buildStructure(entryFullPath, entryRelPath, depth + 1);
            children.push(subStructure);
            fileCount += subStructure.fileCount;
            directoryCount += subStructure.directoryCount;
          } else {
            children.push({
              name: entry.name,
              path: entryRelPath,
              type: 'directory',
            } as FileInfo);
          }
        } else {
          fileCount++;
          const stats = fs.statSync(entryFullPath);
          children.push({
            name: entry.name,
            path: entryRelPath,
            type: 'file',
            extension: path.extname(entry.name),
            size: stats.size,
          });
        }
      }

      return {
        name: path.basename(dir) || 'app',
        path: relPath,
        type: 'directory',
        children: children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
        fileCount,
        directoryCount,
      };
    };

    return buildStructure(fullPath, relativePath, 0);
  }

  async analyzePHPFile(relativePath: string): Promise<PHPClassInfo | null> {
    const { content } = await this.readFile(relativePath);

    // Simple PHP class extraction
    const classMatch = content.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
    if (!classMatch) return null;

    const className = classMatch[1];
    const extendsClass = classMatch[2];
    const implementsInterfaces = classMatch[3]?.split(',').map((s) => s.trim()) || [];

    // Extract methods
    const methodMatches = content.matchAll(/(?:public|private|protected)\s+function\s+(\w+)\s*\(/g);
    const methods = Array.from(methodMatches).map((m) => m[1]);

    // Extract properties
    const propertyMatches = content.matchAll(/(?:public|private|protected)\s+\$(\w+)/g);
    const properties = Array.from(propertyMatches).map((m) => m[1]);

    return {
      name: className,
      file: relativePath,
      extends: extendsClass,
      implements: implementsInterfaces.length > 0 ? implementsInterfaces : undefined,
      methods,
      properties,
    };
  }

  async getSystemOverview(): Promise<{
    path: string;
    framework: string;
    mainDirectories: string[];
    configFiles: string[];
    entryPoints: string[];
  }> {
    const files = await this.listDirectory('');

    // Detect framework
    let framework = 'PHP';
    if (files.some((f) => f.name === 'protected' || f.name === 'yii')) {
      framework = 'Yii Framework';
    } else if (files.some((f) => f.name === 'artisan')) {
      framework = 'Laravel';
    } else if (files.some((f) => f.name === 'symfony.lock')) {
      framework = 'Symfony';
    }

    const mainDirectories = files
      .filter((f) => f.type === 'directory')
      .map((f) => f.name)
      .slice(0, 20);

    const configFiles = files
      .filter(
        (f) =>
          f.type === 'file' &&
          (f.name.includes('config') ||
            f.name.includes('.env') ||
            f.name.includes('settings') ||
            f.name === 'composer.json' ||
            f.name === 'docker-compose.yml'),
      )
      .map((f) => f.name);

    const entryPoints = files
      .filter((f) => f.type === 'file' && (f.name === 'index.php' || f.name.startsWith('index_') || f.name === 'login.php'))
      .map((f) => f.name);

    return {
      path: this.appPath,
      framework,
      mainDirectories,
      configFiles,
      entryPoints,
    };
  }

  async getDatabaseReferences(): Promise<{ file: string; references: string[] }[]> {
    const results: { file: string; references: string[] }[] = [];

    // Search for common database patterns in PHP files
    const patterns = [
      /\$\w*db\w*/gi,
      /pg_connect/gi,
      /pg_query/gi,
      /->query\(/gi,
      /->execute\(/gi,
      /SELECT\s+.*\s+FROM/gi,
      /INSERT\s+INTO/gi,
      /UPDATE\s+\w+\s+SET/gi,
      /DELETE\s+FROM/gi,
    ];

    const processDir = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (['node_modules', 'vendor', 'logs', 'cache', 'tmp'].includes(entry.name)) continue;

          const entryRelativePath = path.join(relativePath, entry.name);
          const entryFullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            processDir(entryFullPath, entryRelativePath);
          } else if (entry.name.endsWith('.php')) {
            try {
              const stats = fs.statSync(entryFullPath);
              if (stats.size > 512 * 1024) continue;

              const content = fs.readFileSync(entryFullPath, 'utf-8');
              const references: string[] = [];

              for (const pattern of patterns) {
                const matches = content.match(pattern);
                if (matches) {
                  references.push(...matches.slice(0, 5).map((m) => m.substring(0, 100)));
                }
              }

              if (references.length > 0) {
                results.push({
                  file: entryRelativePath,
                  references: [...new Set(references)].slice(0, 10),
                });
              }
            } catch {
              // Skip files we can't read
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    processDir(this.appPath);
    return results.slice(0, 50);
  }

  async searchUrlInFiles(url: string): Promise<{
    results: Array<{
      file: string;
      line: number;
      context: string;
      fileType: string;
    }>;
    filesSearched: number;
  }> {
    const results: Array<{
      file: string;
      line: number;
      context: string;
      fileType: string;
    }> = [];

    let filesSearched = 0;

    // Escape special regex characters in URL
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Create regex pattern (case-insensitive). Sem a flag 'g': o regex só é
    // usado em chamadas isoladas de .test() por linha, e um regex global
    // mantém lastIndex entre chamadas — reusado assim, pula matches em
    // linhas diferentes dependendo de onde a busca anterior parou.
    const urlPattern = new RegExp(escapedUrl, 'i');

    // File extensions to search
    const textExtensions = [
      '.php',
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.json',
      '.xml',
      '.ini',
      '.env',
      '.yaml',
      '.yml',
      '.html',
      '.htm',
      '.twig',
      '.blade.php',
      '.txt',
      '.md',
      '.sql',
      '.css',
      '.scss',
    ];

    const isTextFile = (fileName: string): boolean => {
      return textExtensions.some((ext) => fileName.endsWith(ext));
    };

    const processDir = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (['node_modules', 'vendor', 'logs', 'cache', 'tmp', '.git'].includes(entry.name)) continue;

          const entryRelativePath = path.join(relativePath, entry.name);
          const entryFullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            processDir(entryFullPath, entryRelativePath);
          } else if (isTextFile(entry.name)) {
            try {
              const stats = fs.statSync(entryFullPath);
              // Skip files larger than 1MB
              if (stats.size > 1024 * 1024) continue;

              filesSearched++;
              const content = fs.readFileSync(entryFullPath, 'utf-8');
              const lines = content.split('\n');

              // Search for URL in each line
              for (let i = 0; i < lines.length; i++) {
                if (urlPattern.test(lines[i])) {
                  const lineNumber = i + 1;
                  const context = lines[i].trim().substring(0, 300); // Limit context length
                  const fileType = path.extname(entry.name) || 'no-extension';

                  results.push({
                    file: entryRelativePath,
                    line: lineNumber,
                    context,
                    fileType,
                  });

                  // Limit results per file to avoid too many matches
                  if (results.length >= 1000) {
                    return;
                  }
                }
              }
            } catch {
              // Skip files we can't read
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    processDir(this.appPath);

    return {
      results: results.slice(0, 500), // Limit total results
      filesSearched,
    };
  }
}
