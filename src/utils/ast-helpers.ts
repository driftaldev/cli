import * as ts from "typescript";

/**
 * AST-based code analysis utilities
 * These replace string-matching approaches with proper AST parsing
 */

/**
 * Check if a function/method node is async
 */
export function isAsyncFunction(node: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    const modifiers = ts.getCombinedModifierFlags(node);
    return (modifiers & ts.ModifierFlags.Async) !== 0;
  }
  return false;
}

/**
 * Parse TypeScript/JavaScript code and check if a specific function is async
 * @param code Source code string
 * @param functionName Name of the function to check
 * @returns true if the function exists and is async
 */
export function isFunctionAsync(code: string, functionName: string): boolean {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  let result = false;

  function visit(node: ts.Node) {
    // Check function declarations
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      result = isAsyncFunction(node);
      return;
    }

    // Check method declarations
    if (ts.isMethodDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      if (name === functionName) {
        result = isAsyncFunction(node);
        return;
      }
    }

    // Check variable declarations with arrow functions
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === functionName) {
      if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        result = isAsyncFunction(node.initializer);
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Calculate complexity score based on AST node count
 * Counts control flow statements, functions, and error handling
 */
export function getComplexityScore(code: string, language: string = "typescript"): number {
  const sourceFile = ts.createSourceFile(
    `temp.${language === "javascript" ? "js" : "ts"}`,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  let complexity = 0;

  function visit(node: ts.Node) {
    // Control flow complexity (+1 each)
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node)
    ) {
      complexity += 1;
    }

    // Case clauses in switch (+0.5 each)
    if (ts.isCaseClause(node)) {
      complexity += 0.5;
    }

    // Function/method declarations (+0.5 each)
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      complexity += 0.5;
    }

    // Try/catch/finally (+1 each)
    if (ts.isTryStatement(node)) {
      complexity += 1;
    }
    if (ts.isCatchClause(node)) {
      complexity += 0.5;
    }

    // Async/await (+0.5 each for async complexity)
    if (ts.isAwaitExpression(node)) {
      complexity += 0.3;
    }

    // Class/interface declarations (+0.5 each)
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      complexity += 0.5;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return complexity;
}

/**
 * Check if a type/interface is exported
 */
export function isTypeExported(code: string, typeName: string): boolean {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  let result = false;

  function visit(node: ts.Node) {
    // Check if this is a type or interface declaration with the given name
    if (
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name.text === typeName
    ) {
      const modifiers = ts.getCombinedModifierFlags(node);
      result = (modifiers & ts.ModifierFlags.Export) !== 0;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Find all type references in code
 * @param code Source code
 * @param typeName Type name to search for
 * @returns Array of {line, column, context} for each reference
 */
export function findTypeReferences(
  code: string,
  typeName: string
): Array<{ line: number; column: number; context: string }> {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const references: Array<{ line: number; column: number; context: string }> = [];

  function visit(node: ts.Node) {
    // Check type annotations (e.g., foo: TypeName)
    if (ts.isTypeReferenceNode(node)) {
      const typeText = node.typeName.getText(sourceFile);
      if (typeText === typeName || typeText.includes(typeName)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        references.push({
          line: line + 1,
          column: character + 1,
          context: "type annotation"
        });
      }
    }

    // Check type arguments (e.g., Array<TypeName>)
    if (node.kind === ts.SyntaxKind.TypeReference && ts.isTypeReferenceNode(node)) {
      if (node.typeArguments) {
        node.typeArguments.forEach(typeArg => {
          const typeText = typeArg.getText(sourceFile);
          if (typeText === typeName || typeText.includes(typeName)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(typeArg.getStart());
            references.push({
              line: line + 1,
              column: character + 1,
              context: "type argument"
            });
          }
        });
      }
    }

    // Check as Type assertions
    if (ts.isAsExpression(node)) {
      const typeText = node.type.getText(sourceFile);
      if (typeText === typeName || typeText.includes(typeName)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.type.getStart());
        references.push({
          line: line + 1,
          column: character + 1,
          context: "type assertion"
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

/**
 * Compare two function/method signatures to detect breaking changes
 * @returns true if there's a breaking change
 */
export function hasBreakingChange(oldCode: string, newCode: string): boolean {
  const oldSource = ts.createSourceFile("old.ts", oldCode, ts.ScriptTarget.Latest, true);
  const newSource = ts.createSourceFile("new.ts", newCode, ts.ScriptTarget.Latest, true);

  let oldSignature: {
    name: string;
    params: string[];
    returnType: string;
    visibility: ts.ModifierFlags;
  } | null = null;

  let newSignature: {
    name: string;
    params: string[];
    returnType: string;
    visibility: ts.ModifierFlags;
  } | null = null;

  function extractSignature(node: ts.Node, sourceFile: ts.SourceFile) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const name = node.name?.getText(sourceFile) || "anonymous";
      const params = node.parameters.map(p => p.getText(sourceFile));
      const returnType = node.type?.getText(sourceFile) || "any";
      const visibility = ts.getCombinedModifierFlags(node);

      return { name, params, returnType, visibility };
    }
    return null;
  }

  // Extract signatures
  ts.forEachChild(oldSource, (node) => {
    const sig = extractSignature(node, oldSource);
    if (sig) oldSignature = sig;
  });

  ts.forEachChild(newSource, (node) => {
    const sig = extractSignature(node, newSource);
    if (sig) newSignature = sig;
  });

  if (!oldSignature || !newSignature) {
    return false; // Can't compare if we don't have both signatures
  }

  // Check for breaking changes
  // 1. Visibility change (public -> private/protected)
  const oldPublic = (oldSignature.visibility & ts.ModifierFlags.Public) !== 0 ||
                    (oldSignature.visibility & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
  const newPublic = (newSignature.visibility & ts.ModifierFlags.Public) !== 0 ||
                    (newSignature.visibility & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;

  if (oldPublic && !newPublic) {
    return true; // Made less accessible
  }

  // 2. Parameter count change
  if (oldSignature.params.length !== newSignature.params.length) {
    return true;
  }

  // 3. Parameter type change (simplified check)
  for (let i = 0; i < oldSignature.params.length; i++) {
    if (oldSignature.params[i] !== newSignature.params[i]) {
      return true;
    }
  }

  // 4. Return type change
  if (oldSignature.returnType !== newSignature.returnType) {
    return true;
  }

  return false;
}

/**
 * Check if code contains a public method/function
 */
export function hasPublicMethod(code: string): boolean {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  let result = false;

  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const modifiers = ts.getCombinedModifierFlags(node);
      // Public if explicitly marked public OR no private/protected modifier
      const isPublic = (modifiers & ts.ModifierFlags.Public) !== 0 ||
                       (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;

      if (isPublic) {
        result = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

// ==================== Comprehensive AST Extraction Functions ====================

/**
 * Import information
 */
export interface Import {
  source: string;
  items: ImportItem[];
  alias?: string;
  line: number;
  isDefault?: boolean;
  isDynamic?: boolean;
}

export interface ImportItem {
  name: string;
  alias?: string;
  isDefault?: boolean;
}

/**
 * Type definition information
 */
export interface TypeDefinition {
  name: string;
  type: "interface" | "type" | "enum" | "class" | "struct";
  line: number;
  generics?: string[];
  extends?: string[];
  implements?: string[];
  properties?: Property[];
  methods?: Method[];
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
  visibility?: "public" | "private" | "protected";
  isStatic?: boolean;
}

export interface Parameter {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

/**
 * Export information
 */
export interface Export {
  name: string;
  type: "default" | "named" | "all";
  line: number;
}

/**
 * Extract all imports from TypeScript/JavaScript code
 */
export function extractImports(code: string): Import[] {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const imports: Import[] = [];

  function getLineNumber(node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return line + 1;
  }

  function visit(node: ts.Node) {
    // ES6 import declarations
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const source = moduleSpecifier.text;
      const importClause = node.importClause;
      const items: ImportItem[] = [];
      let alias: string | undefined;

      if (importClause) {
        // Default import: import foo from 'module'
        if (importClause.name) {
          items.push({
            name: importClause.name.text,
            isDefault: true,
          });
        }

        // Named bindings
        if (importClause.namedBindings) {
          if (ts.isNamespaceImport(importClause.namedBindings)) {
            // Namespace import: import * as foo from 'module'
            alias = importClause.namedBindings.name.text;
          } else if (ts.isNamedImports(importClause.namedBindings)) {
            // Named imports: import { foo, bar as baz } from 'module'
            importClause.namedBindings.elements.forEach(element => {
              items.push({
                name: element.name.text,
                alias: element.propertyName?.text,
              });
            });
          }
        }
      }

      imports.push({
        source,
        items,
        alias,
        line: getLineNumber(node),
      });
    }

    // CommonJS require: const foo = require('module')
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(decl => {
        if (decl.initializer && ts.isCallExpression(decl.initializer)) {
          const callee = decl.initializer.expression;
          if (ts.isIdentifier(callee) && callee.text === "require") {
            const args = decl.initializer.arguments;
            if (args.length > 0 && ts.isStringLiteral(args[0])) {
              const source = args[0].text;
              const items: ImportItem[] = [];

              // Destructured: const { foo, bar } = require('module')
              if (ts.isObjectBindingPattern(decl.name)) {
                decl.name.elements.forEach(element => {
                  if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                    items.push({
                      name: element.name.text,
                      alias: element.propertyName && ts.isIdentifier(element.propertyName)
                        ? element.propertyName.text
                        : undefined,
                    });
                  }
                });
              }
              // Simple: const foo = require('module')
              else if (ts.isIdentifier(decl.name)) {
                items.push({
                  name: decl.name.text,
                  isDefault: true,
                });
              }

              imports.push({
                source,
                items,
                line: getLineNumber(node),
              });
            }
          }
        }
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Extract all type definitions from TypeScript code
 */
export function extractTypes(code: string): TypeDefinition[] {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const types: TypeDefinition[] = [];

  function getLineNumber(node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return line + 1;
  }

  function extractGenerics(node: ts.Node): string[] | undefined {
    if ("typeParameters" in node && node.typeParameters) {
      const params = node.typeParameters as ts.NodeArray<ts.TypeParameterDeclaration>;
      return params.map(p => p.name.text);
    }
    return undefined;
  }

  function extractHeritageClauses(node: ts.ClassDeclaration | ts.InterfaceDeclaration): {
    extends?: string[];
    implements?: string[];
  } {
    const result: { extends?: string[]; implements?: string[] } = {};

    if (node.heritageClauses) {
      node.heritageClauses.forEach(clause => {
        const names = clause.types.map(t => t.expression.getText(sourceFile));
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          result.extends = names;
        } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
          result.implements = names;
        }
      });
    }

    return result;
  }

  function extractProperties(members: ts.NodeArray<ts.TypeElement | ts.ClassElement>): Property[] {
    const properties: Property[] = [];

    members.forEach(member => {
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        const name = member.name?.getText(sourceFile);
        if (name) {
          properties.push({
            name,
            type: member.type?.getText(sourceFile),
            optional: !!member.questionToken,
            readonly: member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword),
          });
        }
      }
    });

    return properties;
  }

  function extractMethods(members: ts.NodeArray<ts.TypeElement | ts.ClassElement>): Method[] {
    const methods: Method[] = [];

    members.forEach(member => {
      if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
        const name = member.name?.getText(sourceFile);
        if (name) {
          const modifiers = ts.getCombinedModifierFlags(member);
          let visibility: "public" | "private" | "protected" = "public";

          if (modifiers & ts.ModifierFlags.Private) visibility = "private";
          else if (modifiers & ts.ModifierFlags.Protected) visibility = "protected";

          methods.push({
            name,
            parameters: extractMethodParameters(member),
            returnType: member.type?.getText(sourceFile),
            isAsync: (modifiers & ts.ModifierFlags.Async) !== 0,
            visibility,
            isStatic: (modifiers & ts.ModifierFlags.Static) !== 0,
          });
        }
      }
    });

    return methods;
  }

  function extractMethodParameters(
    node: ts.MethodSignature | ts.MethodDeclaration
  ): Parameter[] {
    const parameters: Parameter[] = [];

    node.parameters.forEach(param => {
      const name = param.name.getText(sourceFile);
      parameters.push({
        name,
        type: param.type?.getText(sourceFile),
        optional: !!param.questionToken,
        defaultValue: param.initializer?.getText(sourceFile),
      });
    });

    return parameters;
  }

  function visit(node: ts.Node) {
    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const { extends: extendsClause } = extractHeritageClauses(node);
      types.push({
        name: node.name.text,
        type: "interface",
        line: getLineNumber(node),
        generics: extractGenerics(node),
        extends: extendsClause,
        properties: extractProperties(node.members),
        methods: extractMethods(node.members),
      });
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      types.push({
        name: node.name.text,
        type: "type",
        line: getLineNumber(node),
        generics: extractGenerics(node),
      });
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      types.push({
        name: node.name.text,
        type: "enum",
        line: getLineNumber(node),
      });
    }

    // Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const { extends: extendsClause, implements: implementsClause } = extractHeritageClauses(node);
      types.push({
        name: node.name.text,
        type: "class",
        line: getLineNumber(node),
        generics: extractGenerics(node),
        extends: extendsClause,
        implements: implementsClause,
        properties: extractProperties(node.members),
        methods: extractMethods(node.members),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return types;
}

/**
 * Extract all exports from TypeScript/JavaScript code
 */
export function extractExports(code: string): Export[] {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const exports: Export[] = [];

  function getLineNumber(node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return line + 1;
  }

  function visit(node: ts.Node) {
    // Export declarations: export { foo, bar }
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach(element => {
          exports.push({
            name: element.name.text,
            type: "named",
            line: getLineNumber(element),
          });
        });
      } else if (!node.exportClause) {
        // export * from 'module'
        exports.push({
          name: "*",
          type: "all",
          line: getLineNumber(node),
        });
      }
    }

    // Export assignments: export = foo (CommonJS)
    if (ts.isExportAssignment(node)) {
      if (node.isExportEquals) {
        exports.push({
          name: "=",
          type: "default",
          line: getLineNumber(node),
        });
      } else {
        // export default foo
        const expression = node.expression;
        let name = "default";
        if (ts.isIdentifier(expression)) {
          name = expression.text;
        }
        exports.push({
          name,
          type: "default",
          line: getLineNumber(node),
        });
      }
    }

    // Exported declarations
    if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const isDefault = node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);

      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.push({
          name: node.name.text,
          type: isDefault ? "default" : "named",
          line: getLineNumber(node),
        });
      } else if (ts.isClassDeclaration(node) && node.name) {
        exports.push({
          name: node.name.text,
          type: isDefault ? "default" : "named",
          line: getLineNumber(node),
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        exports.push({
          name: node.name.text,
          type: "named",
          line: getLineNumber(node),
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        exports.push({
          name: node.name.text,
          type: "named",
          line: getLineNumber(node),
        });
      } else if (ts.isEnumDeclaration(node)) {
        exports.push({
          name: node.name.text,
          type: "named",
          line: getLineNumber(node),
        });
      } else if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(decl => {
          if (ts.isIdentifier(decl.name)) {
            exports.push({
              name: decl.name.text,
              type: isDefault ? "default" : "named",
              line: getLineNumber(decl),
            });
          }
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

/**
 * Extract all functions from TypeScript/JavaScript code
 */
export function extractFunctions(code: string): Method[] {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const functions: Method[] = [];

  function getLineNumber(node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return line + 1;
  }

  function extractFunctionParameters(
    node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
  ): Parameter[] {
    const parameters: Parameter[] = [];

    node.parameters.forEach(param => {
      const name = param.name.getText(sourceFile);
      parameters.push({
        name,
        type: param.type?.getText(sourceFile),
        optional: !!param.questionToken,
        defaultValue: param.initializer?.getText(sourceFile),
      });
    });

    return parameters;
  }

  function visit(node: ts.Node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const modifiers = ts.getCombinedModifierFlags(node);
      functions.push({
        name: node.name.text,
        parameters: extractFunctionParameters(node),
        returnType: node.type?.getText(sourceFile),
        isAsync: (modifiers & ts.ModifierFlags.Async) !== 0,
      });
    }

    // Arrow functions and function expressions assigned to variables
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        const name = node.name.getText(sourceFile);
        const modifiers = ts.getCombinedModifierFlags(node.initializer);
        functions.push({
          name,
          parameters: extractFunctionParameters(node.initializer),
          returnType: node.initializer.type?.getText(sourceFile),
          isAsync: (modifiers & ts.ModifierFlags.Async) !== 0,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}
