import {
  LanguageParser,
  Import,
  ImportItem,
  TypeDefinition,
  Export,
  Method,
  Parameter,
  Property,
} from './language-parser';

export class RustParser extends LanguageParser {
  parseImports(): Import[] {
    const imports: Import[] = [];
    const lines = this.getLines();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip comments
      if (!line || line.startsWith('//')) {
        continue;
      }

      // use crate::module;
      const simpleCrateMatch = line.match(/^use\s+crate::([^;]+);/);
      if (simpleCrateMatch) {
        const path = simpleCrateMatch[1];
        const parts = path.split('::');
        const name = parts[parts.length - 1];

        imports.push({
          source: `crate::${path}`,
          items: [{ name }],
          line: lineNumber,
        });
        continue;
      }

      // use module::path;
      const simpleMatch = line.match(/^use\s+([^;{]+);/);
      if (simpleMatch) {
        const path = simpleMatch[1].trim();
        const parts = path.split('::');
        const name = parts[parts.length - 1];

        // Check for 'as' alias
        const asMatch = path.match(/(.+)\s+as\s+(\w+)$/);
        if (asMatch) {
          imports.push({
            source: asMatch[1].trim(),
            items: [{ name: asMatch[1].split('::').pop()!, alias: asMatch[2] }],
            line: lineNumber,
          });
        } else {
          imports.push({
            source: path,
            items: [{ name }],
            line: lineNumber,
          });
        }
        continue;
      }

      // use module::{Item1, Item2, Item3 as Alias};
      const groupMatch = line.match(/^use\s+([^{]+)::{([^}]+)};/);
      if (groupMatch) {
        const basePath = groupMatch[1].trim();
        const items = groupMatch[2].split(',').map(item => {
          const trimmed = item.trim();
          const asMatch = trimmed.match(/(.+)\s+as\s+(\w+)$/);

          if (asMatch) {
            return {
              name: asMatch[1].trim(),
              alias: asMatch[2],
            };
          }

          return { name: trimmed };
        });

        imports.push({
          source: basePath,
          items,
          line: lineNumber,
        });
        continue;
      }

      // use module::*; (glob import)
      const globMatch = line.match(/^use\s+([^;]+)::\*;/);
      if (globMatch) {
        imports.push({
          source: globMatch[1],
          items: [],
          alias: '*',
          line: lineNumber,
        });
        continue;
      }

      // extern crate name;
      const externMatch = line.match(/^extern\s+crate\s+(\w+)(?:\s+as\s+(\w+))?;/);
      if (externMatch) {
        imports.push({
          source: externMatch[1],
          items: [{ name: externMatch[1], alias: externMatch[2] }],
          line: lineNumber,
        });
      }
    }

    return imports;
  }

  parseTypes(): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const code = this.removeComments(this.code, { single: '//', multi: ['/*', '*/'] });

    // Struct definitions
    const structRegex = /(?:pub\s+)?struct\s+(\w+)(?:<([^>]+)>)?\s*{([^}]*)}/gs;
    let match;

    while ((match = structRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const body = match[3];

      types.push({
        name,
        type: 'struct',
        line: this.getLineNumber(match.index),
        generics,
        properties: this.parseStructFields(body),
      });
    }

    // Tuple structs: struct Name(Type1, Type2);
    const tupleStructRegex = /(?:pub\s+)?struct\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]+)\);/g;
    while ((match = tupleStructRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const fields = match[3];

      types.push({
        name,
        type: 'struct',
        line: this.getLineNumber(match.index),
        generics,
        properties: fields.split(',').map((field, idx) => ({
          name: idx.toString(),
          type: field.trim(),
        })),
      });
    }

    // Enum definitions
    const enumRegex = /(?:pub\s+)?enum\s+(\w+)(?:<([^>]+)>)?\s*{([^}]*)}/gs;
    while ((match = enumRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());

      types.push({
        name,
        type: 'enum',
        line: this.getLineNumber(match.index),
        generics,
      });
    }

    // Trait definitions
    const traitRegex = /(?:pub\s+)?trait\s+(\w+)(?:<([^>]+)>)?\s*(?::\s+([^{]+))?\s*{([^}]*)}/gs;
    while ((match = traitRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const bounds = match[3]?.split('+').map(b => b.trim());
      const body = match[4];

      types.push({
        name,
        type: 'trait',
        line: this.getLineNumber(match.index),
        generics,
        extends: bounds,
        methods: this.parseTraitMethods(body),
      });
    }

    // Type aliases
    const typeAliasRegex = /(?:pub\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);/g;
    while ((match = typeAliasRegex.exec(code)) !== null) {
      types.push({
        name: match[1],
        type: 'type',
        line: this.getLineNumber(match.index),
        generics: match[2]?.split(',').map(g => g.trim()),
      });
    }

    return types;
  }

  parseExports(): Export[] {
    const exports: Export[] = [];
    const code = this.code;

    // In Rust, pub items are exported

    // pub fn
    const functionRegex = /^pub\s+(?:async\s+)?(?:const\s+)?fn\s+(\w+)/gm;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    // pub struct/enum/trait/type
    const typeRegex = /^pub\s+(?:struct|enum|trait|type)\s+(\w+)/gm;
    while ((match = typeRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    // pub const/static
    const constRegex = /^pub\s+(?:const|static)\s+(\w+)/gm;
    while ((match = constRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    // pub use (re-export)
    const reexportRegex = /^pub\s+use\s+[^;]*::(\w+)/gm;
    while ((match = reexportRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    return exports;
  }

  parseFunctions(): Method[] {
    const functions: Method[] = [];
    const code = this.code;

    // Function definitions: fn name<T>(params) -> ReturnType
    // Method definitions: fn name(&self, params) -> ReturnType
    const functionRegex = /(?:pub\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*(?:->\s*([^{;]+))?/g;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const params = match[3];
      const returnType = match[4]?.trim();

      // Check if async
      const precedingCode = code.substring(Math.max(0, match.index - 50), match.index);
      const isAsync = precedingCode.includes('async');

      // Determine visibility
      let visibility: 'public' | 'private' | 'protected' = 'private';
      if (precedingCode.includes('pub')) {
        visibility = 'public';
      }

      functions.push({
        name,
        parameters: this.parseRustParameters(params),
        returnType,
        isAsync,
        visibility,
      });
    }

    return functions;
  }

  private parseStructFields(body: string): Property[] {
    const properties: Property[] = [];
    const lines = body.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) {
        continue;
      }

      // Field: pub name: Type,
      const fieldMatch = trimmed.match(/^(?:pub\s+)?(\w+)\s*:\s*([^,]+),?$/);
      if (fieldMatch) {
        properties.push({
          name: fieldMatch[1],
          type: fieldMatch[2].trim(),
        });
      }
    }

    return properties;
  }

  private parseTraitMethods(body: string): Method[] {
    const methods: Method[] = [];
    const functionRegex = /fn\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*(?:->\s*([^{;]+))?/g;
    let match;

    while ((match = functionRegex.exec(body)) !== null) {
      const name = match[1];
      const params = match[3];
      const returnType = match[4]?.trim();

      methods.push({
        name,
        parameters: this.parseRustParameters(params),
        returnType,
      });
    }

    return methods;
  }

  private parseRustParameters(params: string): Parameter[] {
    if (!params.trim()) {
      return [];
    }

    const parameters: Parameter[] = [];
    const paramParts = this.splitRustParams(params);

    for (const part of paramParts) {
      const trimmed = part.trim();

      // self, &self, &mut self, mut self
      if (trimmed.match(/^(?:&(?:mut\s+)?)?self$/)) {
        parameters.push({
          name: 'self',
          type: trimmed,
        });
        continue;
      }

      // Pattern: name: Type
      const match = trimmed.match(/^(?:mut\s+)?(\w+)\s*:\s*(.+)$/);
      if (match) {
        parameters.push({
          name: match[1],
          type: match[2].trim(),
        });
      }
    }

    return parameters;
  }

  private splitRustParams(params: string): string[] {
    // Split by comma, but respect generic brackets and lifetime parameters
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < params.length; i++) {
      const char = params[i];

      if (char === '<' || char === '(') {
        depth++;
      } else if (char === '>' || char === ')') {
        depth--;
      } else if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }
}
