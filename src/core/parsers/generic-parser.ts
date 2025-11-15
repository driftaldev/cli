import {
  LanguageParser,
  Import,
  TypeDefinition,
  Export,
  Method,
} from './language-parser';

/**
 * Generic parser for unsupported languages
 * Provides basic extraction using common patterns
 */
export class GenericParser extends LanguageParser {
  parseImports(): Import[] {
    // Generic parser doesn't extract imports
    return [];
  }

  parseTypes(): TypeDefinition[] {
    // Generic parser doesn't extract types
    return [];
  }

  parseExports(): Export[] {
    // Generic parser doesn't extract exports
    return [];
  }

  parseFunctions(): Method[] {
    // Generic parser doesn't extract functions
    return [];
  }
}
