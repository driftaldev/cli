/**
 * Language-agnostic parser interface for extracting imports, types, and other code structures
 */

export interface Import {
  source: string; // Module/package being imported
  items: ImportItem[]; // What's being imported
  alias?: string; // For namespace imports (import * as X)
  line: number;
  isDefault?: boolean;
  isDynamic?: boolean;
}

export interface ImportItem {
  name: string; // Original name
  alias?: string; // Aliased name (as keyword)
  isDefault?: boolean;
}

export interface TypeDefinition {
  name: string;
  type: 'interface' | 'type' | 'class' | 'struct' | 'enum' | 'trait';
  line: number;
  properties?: Property[];
  methods?: Method[];
  generics?: string[];
  extends?: string[];
  implements?: string[];
}

export interface Property {
  name: string;
  type?: string;
  optional?: boolean;
  readonly?: boolean;
}

export interface Method {
  name: string;
  parameters: Parameter[];
  returnType?: string;
  isAsync?: boolean;
  isStatic?: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface Parameter {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

export interface Export {
  name: string;
  type: 'named' | 'default' | 'all';
  line: number;
}

export interface ParsedCode {
  imports: Import[];
  types: TypeDefinition[];
  exports: Export[];
  functions: Method[];
  classes: TypeDefinition[];
}

/**
 * Base class for language-specific parsers
 */
export abstract class LanguageParser {
  constructor(protected code: string, protected language: string) {}

  abstract parseImports(): Import[];
  abstract parseTypes(): TypeDefinition[];
  abstract parseExports(): Export[];
  abstract parseFunctions(): Method[];

  parse(): ParsedCode {
    return {
      imports: this.parseImports(),
      types: this.parseTypes(),
      exports: this.parseExports(),
      functions: this.parseFunctions(),
      classes: this.parseTypes().filter(t => t.type === 'class'),
    };
  }

  /**
   * Get lines from code
   */
  protected getLines(): string[] {
    return this.code.split('\n');
  }

  /**
   * Get line number from index
   */
  protected getLineNumber(index: number): number {
    return this.code.substring(0, index).split('\n').length;
  }

  /**
   * Remove comments from code (basic implementation)
   */
  protected removeComments(code: string, commentPatterns: { single: string; multi: [string, string] }): string {
    // Remove multi-line comments
    const multiStart = commentPatterns.multi[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const multiEnd = commentPatterns.multi[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code = code.replace(new RegExp(`${multiStart}[\\s\\S]*?${multiEnd}`, 'g'), '');

    // Remove single-line comments
    const singleEscaped = commentPatterns.single.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code = code.replace(new RegExp(`${singleEscaped}.*$`, 'gm'), '');

    return code;
  }
}

/**
 * Factory function to get the appropriate parser for a language
 */
export function getLanguageParser(code: string, language: string): LanguageParser {
  const normalizedLang = normalizeLanguage(language);

  switch (normalizedLang) {
    case 'typescript':
    case 'javascript':
      const { TypeScriptParser } = require('./typescript-parser');
      return new TypeScriptParser(code, language);

    case 'python':
      const { PythonParser } = require('./python-parser');
      return new PythonParser(code, language);

    case 'rust':
      const { RustParser } = require('./rust-parser');
      return new RustParser(code, language);

    case 'go':
      const { GoParser } = require('./go-parser');
      return new GoParser(code, language);

    default:
      // Return a generic parser that does basic extraction
      // For unsupported languages: Java, Ruby, PHP, C#, Swift, Kotlin, C/C++
      const { GenericParser } = require('./generic-parser');
      return new GenericParser(code, language);
  }
}

function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().replace(/[_-]/g, '');

  // Map variations to standard names
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rs': 'rust',
    'rb': 'ruby',
    'cs': 'csharp',
    'c++': 'cpp',
    'kt': 'kotlin',
  };

  return langMap[normalized] || normalized;
}
