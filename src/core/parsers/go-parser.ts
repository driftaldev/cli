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

export class GoParser extends LanguageParser {
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

      // Single import: import "package"
      const singleMatch = line.match(/^import\s+"([^"]+)"$/);
      if (singleMatch) {
        const packagePath = singleMatch[1];
        const packageName = packagePath.split('/').pop() || packagePath;

        imports.push({
          source: packagePath,
          items: [{ name: packageName }],
          line: lineNumber,
        });
        continue;
      }

      // Aliased import: import alias "package"
      const aliasedMatch = line.match(/^import\s+(\w+)\s+"([^"]+)"$/);
      if (aliasedMatch) {
        const alias = aliasedMatch[1];
        const packagePath = aliasedMatch[2];

        imports.push({
          source: packagePath,
          items: [{ name: packagePath.split('/').pop() || packagePath, alias }],
          alias,
          line: lineNumber,
        });
        continue;
      }

      // Dot import: import . "package" (imports into current namespace)
      const dotMatch = line.match(/^import\s+\.\s+"([^"]+)"$/);
      if (dotMatch) {
        imports.push({
          source: dotMatch[1],
          items: [],
          alias: '.',
          line: lineNumber,
        });
        continue;
      }

      // Multi-line import block: import ( ... )
      if (line === 'import (') {
        let j = i + 1;
        while (j < lines.length) {
          const blockLine = lines[j].trim();

          if (blockLine === ')') {
            break;
          }

          if (blockLine && !blockLine.startsWith('//')) {
            // Parse each line in the block
            const blockSingleMatch = blockLine.match(/^"([^"]+)"$/);
            if (blockSingleMatch) {
              const packagePath = blockSingleMatch[1];
              const packageName = packagePath.split('/').pop() || packagePath;

              imports.push({
                source: packagePath,
                items: [{ name: packageName }],
                line: j + 1,
              });
            }

            const blockAliasedMatch = blockLine.match(/^(\w+)\s+"([^"]+)"$/);
            if (blockAliasedMatch) {
              const alias = blockAliasedMatch[1];
              const packagePath = blockAliasedMatch[2];

              imports.push({
                source: packagePath,
                items: [{ name: packagePath.split('/').pop() || packagePath, alias }],
                alias,
                line: j + 1,
              });
            }

            const blockDotMatch = blockLine.match(/^\.\s+"([^"]+)"$/);
            if (blockDotMatch) {
              imports.push({
                source: blockDotMatch[1],
                items: [],
                alias: '.',
                line: j + 1,
              });
            }
          }

          j++;
        }
        i = j;
      }
    }

    return imports;
  }

  parseTypes(): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const code = this.removeComments(this.code, { single: '//', multi: ['/*', '*/'] });

    // Struct definitions
    const structRegex = /type\s+(\w+)\s+struct\s*{([^}]*)}/gs;
    let match;

    while ((match = structRegex.exec(code)) !== null) {
      const name = match[1];
      const body = match[2];

      types.push({
        name,
        type: 'struct',
        line: this.getLineNumber(match.index),
        properties: this.parseStructFields(body),
      });
    }

    // Interface definitions
    const interfaceRegex = /type\s+(\w+)\s+interface\s*{([^}]*)}/gs;
    while ((match = interfaceRegex.exec(code)) !== null) {
      const name = match[1];
      const body = match[2];

      types.push({
        name,
        type: 'interface',
        line: this.getLineNumber(match.index),
        methods: this.parseInterfaceMethods(body),
      });
    }

    // Type aliases
    const typeAliasRegex = /type\s+(\w+)\s+(.+)/g;
    while ((match = typeAliasRegex.exec(code)) !== null) {
      const name = match[1];
      const definition = match[2].trim();

      // Skip if it's a struct or interface (already handled)
      if (!definition.startsWith('struct') && !definition.startsWith('interface')) {
        types.push({
          name,
          type: 'type',
          line: this.getLineNumber(match.index),
        });
      }
    }

    return types;
  }

  parseExports(): Export[] {
    const exports: Export[] = [];
    const code = this.code;

    // In Go, exported identifiers start with uppercase letter

    // Exported functions
    const functionRegex = /^func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)/gm;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    // Exported types
    const typeRegex = /^type\s+([A-Z]\w+)/gm;
    while ((match = typeRegex.exec(code)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(match.index),
      });
    }

    // Exported variables/constants
    const varRegex = /^(?:var|const)\s+([A-Z]\w+)/gm;
    while ((match = varRegex.exec(code)) !== null) {
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

    // Function definitions: func name(params) returnType
    // Method definitions: func (receiver Type) name(params) returnType
    const functionRegex = /func\s+(?:\(([^)]+)\)\s+)?(\w+)\s*\(([^)]*)\)\s*([^{]*)/g;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      const receiver = match[1];
      const name = match[2];
      const params = match[3];
      const returnPart = match[4].trim();

      // Parse return type(s)
      let returnType: string | undefined;
      if (returnPart) {
        // Remove leading/trailing whitespace and parentheses for multiple returns
        returnType = returnPart.replace(/^\(|\)$/g, '').trim() || undefined;
      }

      functions.push({
        name,
        parameters: this.parseGoParameters(params, receiver),
        returnType,
        isStatic: !receiver, // Go methods have receivers
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

      // Field with type: Name Type `json:"name"`
      // Embedded field: Type
      const fieldMatch = trimmed.match(/^(\w+)\s+(.+?)(?:`[^`]*`)?$/);
      if (fieldMatch) {
        const name = fieldMatch[1];
        const type = fieldMatch[2].trim().replace(/`[^`]*`$/, '').trim();

        properties.push({
          name,
          type,
        });
      } else {
        // Embedded type (anonymous field)
        const embeddedMatch = trimmed.match(/^([*]?\w+(?:\[[\w\s,]+\])?)$/);
        if (embeddedMatch) {
          properties.push({
            name: embeddedMatch[1],
            type: embeddedMatch[1],
          });
        }
      }
    }

    return properties;
  }

  private parseInterfaceMethods(body: string): Method[] {
    const methods: Method[] = [];
    const lines = body.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) {
        continue;
      }

      // Method signature: MethodName(params) returnType
      const methodMatch = trimmed.match(/^(\w+)\s*\(([^)]*)\)\s*(.*)$/);
      if (methodMatch) {
        const name = methodMatch[1];
        const params = methodMatch[2];
        const returnType = methodMatch[3].trim() || undefined;

        methods.push({
          name,
          parameters: this.parseGoParameters(params),
          returnType,
        });
      } else {
        // Embedded interface
        const embeddedMatch = trimmed.match(/^(\w+)$/);
        if (embeddedMatch) {
          // This is an embedded interface, not a method
          // Could track this separately if needed
        }
      }
    }

    return methods;
  }

  private parseGoParameters(params: string, receiver?: string): Parameter[] {
    const parameters: Parameter[] = [];

    // Add receiver as first parameter if present
    if (receiver) {
      const receiverMatch = receiver.trim().match(/^(\w+)\s+([*]?\w+)/);
      if (receiverMatch) {
        parameters.push({
          name: receiverMatch[1],
          type: receiverMatch[2],
        });
      }
    }

    if (!params.trim()) {
      return parameters;
    }

    // Go parameters can be: name type, name1, name2 type
    const paramParts = params.split(',');
    let currentType: string | undefined;

    for (let i = paramParts.length - 1; i >= 0; i--) {
      const part = paramParts[i].trim();

      // Check if this part has a type
      const match = part.match(/^(\w+)\s+(.+)$/);
      if (match) {
        currentType = match[2].trim();
        parameters.unshift({
          name: match[1],
          type: currentType,
        });
      } else {
        // Just a name, use the last seen type
        parameters.unshift({
          name: part,
          type: currentType,
        });
      }
    }

    return parameters;
  }
}
