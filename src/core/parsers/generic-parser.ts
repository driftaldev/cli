import {
  LanguageParser,
  Import,
  TypeDefinition,
  Export,
  Method,
} from './language-parser';

/**
 * Generic parser for unsupported languages
 *
 * This parser explicitly disables code analysis for languages that do not have AST-based parsers.
 * Supported languages (with AST parsers): TypeScript, JavaScript, Rust, Python, Go
 * Unsupported languages (disabled): Java, Ruby, PHP, C#, Swift, Kotlin, C, C++, and others
 *
 * For unsupported languages, this parser returns empty results instead of using
 * unreliable regex-based parsing, prioritizing accuracy over partial analysis.
 */
export class GenericParser extends LanguageParser {
  parseImports(): Import[] {
    // Parsing disabled for unsupported languages - AST parser not available
    return [];
  }

  parseTypes(): TypeDefinition[] {
    // Parsing disabled for unsupported languages - AST parser not available
    return [];
  }

  parseExports(): Export[] {
    // Parsing disabled for unsupported languages - AST parser not available
    return [];
  }

  parseFunctions(): Method[] {
    // Parsing disabled for unsupported languages - AST parser not available
    return [];
  }
}
