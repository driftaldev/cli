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
} from '../../utils/go-ast-helpers.js';

/**
 * Go parser using AST-based parsing
 * Uses tree-sitter-go for accurate, reliable parsing
 */
export class GoParser extends LanguageParser {
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
