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
