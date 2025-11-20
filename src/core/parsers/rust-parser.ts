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
} from '../../utils/rust-ast-helpers.js';

/**
 * Rust parser using AST-based parsing
 * Uses tree-sitter-rust for accurate, reliable parsing
 */
export class RustParser extends LanguageParser {
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
