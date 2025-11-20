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

export class PythonParser extends LanguageParser {
  parseImports(): Import[] {
    const imports: Import[] = [];
    const lines = this.getLines();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) {
        continue;
      }

      // from module import foo, bar as baz
      const fromImportMatch = line.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
      if (fromImportMatch) {
        const source = fromImportMatch[1];
        const importPart = fromImportMatch[2];

        // Handle: from module import *
        if (importPart.trim() === '*') {
          imports.push({
            source,
            items: [],
            alias: '*',
            line: lineNumber,
          });
          continue;
        }

        // Handle: from module import (foo, bar, baz) - multiline
        // Use proper parenthesis depth tracking instead of string matching
        let fullImportPart = importPart;
        let parenDepth = (importPart.match(/\(/g) || []).length - (importPart.match(/\)/g) || []).length;

        if (parenDepth > 0) {
          // Multiline import, collect until parentheses are balanced
          let j = i + 1;
          while (j < lines.length && parenDepth > 0) {
            const nextLine = lines[j].trim();
            fullImportPart += ' ' + nextLine;

            // Update parenthesis depth
            parenDepth += (nextLine.match(/\(/g) || []).length;
            parenDepth -= (nextLine.match(/\)/g) || []).length;

            j++;
          }
          i = j - 1; // Skip processed lines
        }

        // Parse imported items
        const itemsPart = fullImportPart.replace(/[()]/g, '');
        const items: ImportItem[] = itemsPart.split(',').map(item => {
          const parts = item.trim().split(/\s+as\s+/);
          return {
            name: parts[0].trim(),
            alias: parts[1]?.trim(),
          };
        }).filter(item => item.name);

        imports.push({
          source,
          items,
          line: lineNumber,
        });
        continue;
      }

      // import module
      // import module as alias
      // import module1, module2
      const importMatch = line.match(/^import\s+(.+)/);
      if (importMatch) {
        const modules = importMatch[1].split(',');

        for (const mod of modules) {
          const parts = mod.trim().split(/\s+as\s+/);
          imports.push({
            source: parts[0].trim(),
            items: [],
            alias: parts[1]?.trim(),
            line: lineNumber,
          });
        }
      }
    }

    return imports;
  }

  parseTypes(): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const lines = this.getLines();
    const code = this.removeComments(this.code, { single: '#', multi: ['"""', '"""'] });

    // Class definitions
    const classRegex = /class\s+(\w+)(?:\(([^)]*)\))?:\s*/g;
    let match;

    while ((match = classRegex.exec(code)) !== null) {
      const name = match[1];
      const bases = match[2]?.split(',').map(b => b.trim()).filter(Boolean);
      const lineNumber = this.getLineNumber(match.index);

      // Extract class body (methods and properties)
      const classStart = match.index + match[0].length;
      const classBody = this.extractIndentedBlock(code, classStart);

      types.push({
        name,
        type: 'class',
        line: lineNumber,
        extends: bases,
        methods: this.parseMethodsFromBody(classBody),
        properties: this.parsePropertiesFromBody(classBody),
      });
    }

    // TypedDict (Python 3.8+)
    const typedDictRegex = /(\w+)\s*=\s*TypedDict\(['"](\w+)['"],\s*{([^}]*)}/g;
    while ((match = typedDictRegex.exec(code)) !== null) {
      types.push({
        name: match[1],
        type: 'interface', // Treat TypedDict as interface equivalent
        line: this.getLineNumber(match.index),
        properties: this.parseTypedDictProperties(match[3]),
      });
    }

    // Enum definitions
    const enumRegex = /class\s+(\w+)\(Enum\):/g;
    while ((match = enumRegex.exec(code)) !== null) {
      types.push({
        name: match[1],
        type: 'enum',
        line: this.getLineNumber(match.index),
      });
    }

    return types;
  }

  parseExports(): Export[] {
    const exports: Export[] = [];
    const lines = this.getLines();

    // Python uses __all__ for explicit exports
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // __all__ = ['foo', 'bar']
      const allMatch = line.match(/__all__\s*=\s*\[([^\]]+)\]/);
      if (allMatch) {
        const names = allMatch[1].split(',').map(n => n.trim().replace(/['"]/g, ''));
        names.forEach(name => {
          exports.push({
            name,
            type: 'named',
            line: i + 1,
          });
        });
      }
    }

    // If no __all__, consider all non-private top-level definitions as exports
    if (exports.length === 0) {
      const code = this.code;

      // Functions
      const functionRegex = /^(?:def|async def)\s+([a-zA-Z]\w*)/gm;
      let match;
      while ((match = functionRegex.exec(code)) !== null) {
        if (!match[1].startsWith('_')) {
          exports.push({
            name: match[1],
            type: 'named',
            line: this.getLineNumber(match.index),
          });
        }
      }

      // Classes
      const classRegex = /^class\s+([a-zA-Z]\w*)/gm;
      while ((match = classRegex.exec(code)) !== null) {
        if (!match[1].startsWith('_')) {
          exports.push({
            name: match[1],
            type: 'named',
            line: this.getLineNumber(match.index),
          });
        }
      }

      // Top-level variables (constants)
      const varRegex = /^([A-Z][A-Z0-9_]*)\s*=/gm;
      while ((match = varRegex.exec(code)) !== null) {
        exports.push({
          name: match[1],
          type: 'named',
          line: this.getLineNumber(match.index),
        });
      }
    }

    return exports;
  }

  parseFunctions(): Method[] {
    const functions: Method[] = [];
    const code = this.code;

    // Function definitions (including async)
    const functionRegex = /^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/gm;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      const isAsync = !!match[1];
      const name = match[2];
      const params = match[3];
      const returnType = match[4]?.trim();

      // Skip private methods (but include at top level for export detection)
      if (this.getIndentLevel(code, match.index) === 0 || !name.startsWith('_')) {
        functions.push({
          name,
          parameters: this.parsePythonParameters(params),
          returnType,
          isAsync,
        });
      }
    }

    return functions;
  }

  private parseMethodsFromBody(body: string): Method[] {
    const methods: Method[] = [];
    const methodRegex = /(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/g;
    let match;

    while ((match = methodRegex.exec(body)) !== null) {
      const isAsync = !!match[1];
      const name = match[2];
      const params = match[3];
      const returnType = match[4]?.trim();

      // Determine visibility based on name
      let visibility: 'public' | 'private' | 'protected' = 'public';
      if (name.startsWith('__') && !name.endsWith('__')) {
        visibility = 'private';
      } else if (name.startsWith('_')) {
        visibility = 'protected';
      }

      methods.push({
        name,
        parameters: this.parsePythonParameters(params),
        returnType,
        isAsync,
        visibility,
      });
    }

    return methods;
  }

  private parsePropertiesFromBody(body: string): Property[] {
    const properties: Property[] = [];

    // Instance variables with type hints
    const propRegex = /self\.(\w+)\s*:\s*([^=\n]+)/g;
    let match;

    while ((match = propRegex.exec(body)) !== null) {
      properties.push({
        name: match[1],
        type: match[2].trim(),
      });
    }

    // Class variables
    const classVarRegex = /^(\s*)([a-zA-Z]\w*)\s*:\s*([^=\n]+)/gm;
    while ((match = classVarRegex.exec(body)) !== null) {
      // Skip if it's inside a method (indented more than class level)
      const indent = match[1].length;
      if (indent <= 4) { // Assume 4-space or 1-tab indentation
        properties.push({
          name: match[2],
          type: match[3].trim(),
        });
      }
    }

    return properties;
  }

  private parseTypedDictProperties(propsStr: string): Property[] {
    const properties: Property[] = [];
    const propPairs = propsStr.split(',');

    for (const pair of propPairs) {
      const match = pair.trim().match(/['"](\w+)['"]\s*:\s*(.+)/);
      if (match) {
        properties.push({
          name: match[1],
          type: match[2].trim(),
        });
      }
    }

    return properties;
  }

  private parsePythonParameters(params: string): Parameter[] {
    if (!params.trim()) {
      return [];
    }

    return params.split(',').map(param => {
      const trimmed = param.trim();

      // Skip self and cls
      if (trimmed === 'self' || trimmed === 'cls') {
        return null;
      }

      // Parameter with type hint and default: name: type = default
      let match = trimmed.match(/^(\w+)\s*:\s*([^=]+)(?:=\s*(.+))?$/);
      if (match) {
        return {
          name: match[1],
          type: match[2].trim(),
          defaultValue: match[3]?.trim(),
          optional: !!match[3],
        };
      }

      // Parameter with default: name = default
      match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        return {
          name: match[1],
          defaultValue: match[2].trim(),
          optional: true,
        };
      }

      // Parameter with type hint: name: type
      match = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
      if (match) {
        return {
          name: match[1],
          type: match[2].trim(),
        };
      }

      // Simple parameter: name
      if (trimmed.match(/^\w+$/)) {
        return {
          name: trimmed,
        };
      }

      return null;
    }).filter((p): p is Parameter => p !== null);
  }

  private extractIndentedBlock(code: string, startIndex: number): string {
    const lines = code.substring(startIndex).split('\n');
    const result: string[] = [];
    let baseIndent: number | null = null;

    for (const line of lines) {
      if (!line.trim()) {
        result.push(line);
        continue;
      }

      const indent = line.search(/\S/);

      if (baseIndent === null) {
        baseIndent = indent;
        result.push(line);
      } else if (indent >= baseIndent) {
        result.push(line);
      } else {
        // Dedented line, end of block
        break;
      }
    }

    return result.join('\n');
  }

  private getIndentLevel(code: string, index: number): number {
    // Find the start of the line
    let lineStart = index;
    while (lineStart > 0 && code[lineStart - 1] !== '\n') {
      lineStart--;
    }

    const line = code.substring(lineStart, index);
    return line.search(/\S/);
  }
}
