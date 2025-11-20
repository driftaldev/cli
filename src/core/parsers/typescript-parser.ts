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
import { isFunctionAsync } from '../../utils/ast-helpers.js';

export class TypeScriptParser extends LanguageParser {
  parseImports(): Import[] {
    const imports: Import[] = [];
    const lines = this.getLines();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip comments and empty lines
      if (!line || line.startsWith('//') || line.startsWith('/*')) {
        continue;
      }

      // ES6 Named imports: import { foo, bar as baz } from 'module'
      const namedMatch = line.match(/import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
      if (namedMatch) {
        const items: ImportItem[] = namedMatch[1]
          .split(',')
          .map(item => {
            const parts = item.trim().split(/\s+as\s+/);
            return {
              name: parts[0].trim(),
              alias: parts[1]?.trim(),
            };
          })
          .filter(item => item.name);

        imports.push({
          source: namedMatch[2],
          items,
          line: lineNumber,
        });
        continue;
      }

      // ES6 Default import: import foo from 'module'
      const defaultMatch = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (defaultMatch) {
        imports.push({
          source: defaultMatch[2],
          items: [{ name: defaultMatch[1], isDefault: true }],
          line: lineNumber,
          isDefault: true,
        });
        continue;
      }

      // ES6 Namespace import: import * as foo from 'module'
      const namespaceMatch = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (namespaceMatch) {
        imports.push({
          source: namespaceMatch[2],
          items: [],
          alias: namespaceMatch[1],
          line: lineNumber,
        });
        continue;
      }

      // ES6 Mixed import: import foo, { bar } from 'module'
      const mixedMatch = line.match(/import\s+(\w+)\s*,\s*{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
      if (mixedMatch) {
        const items: ImportItem[] = [
          { name: mixedMatch[1], isDefault: true },
          ...mixedMatch[2].split(',').map(item => {
            const parts = item.trim().split(/\s+as\s+/);
            return {
              name: parts[0].trim(),
              alias: parts[1]?.trim(),
            };
          }),
        ];

        imports.push({
          source: mixedMatch[3],
          items,
          line: lineNumber,
        });
        continue;
      }

      // Side-effect import: import 'module'
      const sideEffectMatch = line.match(/import\s+['"]([^'"]+)['"]/);
      if (sideEffectMatch) {
        imports.push({
          source: sideEffectMatch[1],
          items: [],
          line: lineNumber,
        });
        continue;
      }

      // CommonJS require: const foo = require('module')
      const requireMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/);
      if (requireMatch) {
        imports.push({
          source: requireMatch[2],
          items: [{ name: requireMatch[1], isDefault: true }],
          line: lineNumber,
        });
        continue;
      }

      // CommonJS destructured require: const { foo, bar } = require('module')
      const destructuredRequireMatch = line.match(/(?:const|let|var)\s+{([^}]+)}\s*=\s*require\(['"]([^'"]+)['"]\)/);
      if (destructuredRequireMatch) {
        const items: ImportItem[] = destructuredRequireMatch[1]
          .split(',')
          .map(item => {
            const parts = item.trim().split(/\s*:\s*/);
            return {
              name: parts[0].trim(),
              alias: parts[1]?.trim(),
            };
          })
          .filter(item => item.name);

        imports.push({
          source: destructuredRequireMatch[2],
          items,
          line: lineNumber,
        });
        continue;
      }

      // Dynamic import: import('module')
      const dynamicMatch = line.match(/import\(['"]([^'"]+)['"]\)/);
      if (dynamicMatch) {
        imports.push({
          source: dynamicMatch[1],
          items: [],
          line: lineNumber,
          isDynamic: true,
        });
        continue;
      }

      // Type-only import: import type { Foo } from 'module'
      const typeImportMatch = line.match(/import\s+type\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
      if (typeImportMatch) {
        const items: ImportItem[] = typeImportMatch[1]
          .split(',')
          .map(item => {
            const parts = item.trim().split(/\s+as\s+/);
            return {
              name: parts[0].trim(),
              alias: parts[1]?.trim(),
            };
          })
          .filter(item => item.name);

        imports.push({
          source: typeImportMatch[2],
          items,
          line: lineNumber,
        });
      }
    }

    return imports;
  }

  parseTypes(): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const code = this.removeComments(this.code, { single: '//', multi: ['/*', '*/'] });

    // Interface definitions
    const interfaceRegex = /interface\s+(\w+)(?:<([^>]+)>)?\s+(?:extends\s+([\w,\s]+))?\s*{([^}]*)}/gs;
    let match;

    while ((match = interfaceRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const extendsClause = match[3]?.split(',').map(e => e.trim());
      const body = match[4];

      types.push({
        name,
        type: 'interface',
        line: this.getLineNumber(match.index),
        generics,
        extends: extendsClause,
        properties: this.parseProperties(body),
        methods: this.parseMethods(body),
      });
    }

    // Type aliases
    const typeRegex = /type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);?/g;
    while ((match = typeRegex.exec(code)) !== null) {
      types.push({
        name: match[1],
        type: 'type',
        line: this.getLineNumber(match.index),
        generics: match[2]?.split(',').map(g => g.trim()),
      });
    }

    // Enum definitions
    const enumRegex = /enum\s+(\w+)\s*{([^}]*)}/gs;
    while ((match = enumRegex.exec(code)) !== null) {
      types.push({
        name: match[1],
        type: 'enum',
        line: this.getLineNumber(match.index),
      });
    }

    // Class definitions
    const classRegex = /class\s+(\w+)(?:<([^>]+)>)?\s*(?:extends\s+(\w+))?\s*(?:implements\s+([\w,\s]+))?\s*{([^}]*)}/gs;
    while ((match = classRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2]?.split(',').map(g => g.trim());
      const extendsClause = match[3] ? [match[3]] : undefined;
      const implementsClause = match[4]?.split(',').map(i => i.trim());
      const body = match[5];

      types.push({
        name,
        type: 'class',
        line: this.getLineNumber(match.index),
        generics,
        extends: extendsClause,
        implements: implementsClause,
        properties: this.parseProperties(body),
        methods: this.parseMethods(body),
      });
    }

    return types;
  }

  parseExports(): Export[] {
    const exports: Export[] = [];
    const lines = this.getLines();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip comments
      if (!line || line.startsWith('//') || line.startsWith('/*')) {
        continue;
      }

      // Default export: export default foo
      if (line.match(/export\s+default\s+/)) {
        const match = line.match(/export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)/);
        exports.push({
          name: match?.[1] || 'default',
          type: 'default',
          line: lineNumber,
        });
        continue;
      }

      // Named exports: export { foo, bar }
      const namedMatch = line.match(/export\s+{([^}]+)}/);
      if (namedMatch) {
        namedMatch[1].split(',').forEach(name => {
          exports.push({
            name: name.trim().split(/\s+as\s+/)[0],
            type: 'named',
            line: lineNumber,
          });
        });
        continue;
      }

      // Export declarations: export const/function/class/interface/type/enum
      const declMatch = line.match(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/);
      if (declMatch) {
        exports.push({
          name: declMatch[1],
          type: 'named',
          line: lineNumber,
        });
        continue;
      }

      // Re-export: export * from 'module'
      if (line.match(/export\s+\*\s+from\s+/)) {
        exports.push({
          name: '*',
          type: 'all',
          line: lineNumber,
        });
      }
    }

    return exports;
  }

  parseFunctions(): Method[] {
    const functions: Method[] = [];
    const code = this.removeComments(this.code, { single: '//', multi: ['/*', '*/'] });

    // Function declarations
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*{/g;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      const name = match[1];
      const generics = match[2];
      const params = match[3];
      const returnType = match[4]?.trim();
      // Use AST-based async detection instead of string matching
      const isAsync = isFunctionAsync(code, name);

      functions.push({
        name,
        parameters: this.parseParameters(params),
        returnType,
        isAsync,
      });
    }

    // Arrow functions (const foo = async () => {})
    const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/g;
    while ((match = arrowRegex.exec(code)) !== null) {
      const name = match[1];
      const isAsync = !!match[2];
      const params = match[3];
      const returnType = match[4]?.trim();

      functions.push({
        name,
        parameters: this.parseParameters(params),
        returnType,
        isAsync,
      });
    }

    return functions;
  }

  private parseProperties(body: string): Property[] {
    const properties: Property[] = [];
    const lines = body.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Property: foo: string; or foo?: number;
      const propertyMatch = trimmed.match(/^(?:readonly\s+)?(\w+)(\?)?:\s*([^;]+);?/);
      if (propertyMatch) {
        properties.push({
          name: propertyMatch[1],
          type: propertyMatch[3].trim(),
          optional: !!propertyMatch[2],
          readonly: trimmed.startsWith('readonly'),
        });
      }
    }

    return properties;
  }

  private parseMethods(body: string): Method[] {
    const methods: Method[] = [];
    const methodRegex = /(?:(async)\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?/g;
    let match;

    while ((match = methodRegex.exec(body)) !== null) {
      const isAsync = !!match[1];
      const name = match[2];
      const params = match[3];
      const returnType = match[4]?.trim();

      // Skip property declarations
      if (body[match.index - 1] === ':') {
        continue;
      }

      methods.push({
        name,
        parameters: this.parseParameters(params),
        returnType,
        isAsync,
      });
    }

    return methods;
  }

  private parseParameters(params: string): Parameter[] {
    if (!params.trim()) {
      return [];
    }

    return params.split(',').map(param => {
      const trimmed = param.trim();
      const match = trimmed.match(/^(\w+)(\?)?:\s*([^=]+)(?:=\s*(.+))?$/);

      if (match) {
        return {
          name: match[1],
          type: match[3].trim(),
          optional: !!match[2],
          defaultValue: match[4]?.trim(),
        };
      }

      // Fallback for untyped parameters
      const simpleMatch = trimmed.match(/^(\w+)(?:=\s*(.+))?$/);
      if (simpleMatch) {
        return {
          name: simpleMatch[1],
          defaultValue: simpleMatch[2]?.trim(),
        };
      }

      return { name: trimmed };
    }).filter(p => p.name);
  }
}
