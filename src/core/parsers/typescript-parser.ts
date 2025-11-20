import {
  LanguageParser,
  Import,
  TypeDefinition,
  Export,
  Method,
} from './language-parser';
import {
  extractImports,
  extractTypes,
  extractExports,
  extractFunctions,
} from '../../utils/ast-helpers.js';

/**
 * TypeScript/JavaScript parser using AST-based parsing
 * Uses TypeScript Compiler API for accurate, reliable parsing
 */
export class TypeScriptParser extends LanguageParser {
  parseImports(): Import[] {
    return extractImports(this.code);
  }

  parseTypes(): TypeDefinition[] {
    return extractTypes(this.code);
  }

  parseExports(): Export[] {
    return extractExports(this.code);
  }

  parseFunctions(): Method[] {
    return extractFunctions(this.code);
  }
}
