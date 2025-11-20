import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import {
  Import,
  ImportItem,
  TypeDefinition,
  Export,
  Method,
  Parameter,
  Property,
} from "../core/parsers/language-parser";

/**
 * Python AST-based code analysis utilities
 * Uses tree-sitter-python for proper parsing instead of regex matching
 */

// Initialize parser
let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python);
  }
  return parser;
}

/**
 * Extract all import statements from Python code
 */
export function extractImports(code: string): Import[] {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    const imports: Import[] = [];

    function getLineNumber(node: Parser.SyntaxNode): number {
      return node.startPosition.row + 1;
    }

    function traverse(node: Parser.SyntaxNode) {
      // Handle: import module [as alias]
      if (node.type === "import_statement") {
        const dotted = node.childForFieldName("name");
        if (dotted) {
          const source = dotted.text;
          const alias = node.children.find(c => c.type === "as")?.nextSibling?.text;
          imports.push({
            source,
            items: [],
            alias,
            line: getLineNumber(node),
          });
        }
      }

      // Handle: from module import foo, bar
      if (node.type === "import_from_statement") {
        const moduleNode = node.childForFieldName("module_name");
        const source = moduleNode ? moduleNode.text : "";
        const items: ImportItem[] = [];

        // Find all imported names
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          // Handle wildcard import: from module import *
          if (child.type === "wildcard_import") {
            imports.push({
              source,
              items: [],
              alias: "*",
              line: getLineNumber(node),
            });
            return; // Don't process further
          }

          // Handle aliased import
          if (child.type === "aliased_import") {
            const nameNode = child.childForFieldName("name");
            const aliasNode = child.childForFieldName("alias");
            if (nameNode) {
              items.push({
                name: nameNode.text,
                alias: aliasNode?.text,
              });
            }
          }

          // Handle dotted name (simple import)
          if (child.type === "dotted_name" && child.parent?.type === "import_from_statement") {
            // Check if this is the module name or imported name
            const prevSibling = child.previousSibling;
            if (prevSibling?.type === "import") {
              items.push({
                name: child.text,
              });
            }
          }
        }

        if (items.length > 0 || source) {
          imports.push({
            source,
            items,
            line: getLineNumber(node),
          });
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    traverse(rootNode);
    return imports;
  } catch (error) {
    console.error("Python import parsing error:", error);
    return [];
  }
}

/**
 * Extract type definitions (classes, enums, etc.) from Python code
 */
export function extractTypes(code: string): TypeDefinition[] {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    const types: TypeDefinition[] = [];

    function getLineNumber(node: Parser.SyntaxNode): number {
      return node.startPosition.row + 1;
    }

    function extractClassBases(node: Parser.SyntaxNode): string[] | undefined {
      const argList = node.childForFieldName("superclasses");
      if (!argList) return undefined;

      const bases: string[] = [];
      for (let i = 0; i < argList.childCount; i++) {
        const child = argList.child(i);
        if (child && child.type !== "(" && child.type !== ")" && child.type !== ",") {
          bases.push(child.text);
        }
      }
      return bases.length > 0 ? bases : undefined;
    }

    function extractMethods(classBody: Parser.SyntaxNode): Method[] {
      const methods: Method[] = [];

      for (let i = 0; i < classBody.childCount; i++) {
        const child = classBody.child(i);
        if (!child || child.type !== "function_definition") continue;

        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;

        const name = nameNode.text;
        const isAsync = child.children.some(c => c.type === "async");

        // Determine visibility based on Python naming conventions
        let visibility: "public" | "private" | "protected" = "public";
        if (name.startsWith("__") && !name.endsWith("__")) {
          visibility = "private";
        } else if (name.startsWith("_")) {
          visibility = "protected";
        }

        const params = extractParameters(child);
        const returnTypeNode = child.childForFieldName("return_type");

        methods.push({
          name,
          parameters: params,
          returnType: returnTypeNode?.text,
          isAsync,
          visibility,
        });
      }

      return methods;
    }

    function extractProperties(classBody: Parser.SyntaxNode): Property[] {
      const properties: Property[] = [];

      for (let i = 0; i < classBody.childCount; i++) {
        const child = classBody.child(i);
        if (!child) continue;

        // Look for annotated assignments: name: type = value
        if (child.type === "expression_statement") {
          const assignment = child.child(0);
          if (assignment?.type === "assignment") {
            const left = assignment.childForFieldName("left");
            if (left?.type === "identifier") {
              // Check for type annotation
              const typeNode = assignment.children.find(c => c.type === "type");
              properties.push({
                name: left.text,
                type: typeNode?.text,
              });
            }
          }
        }
      }

      return properties;
    }

    function traverse(node: Parser.SyntaxNode, depth: number = 0) {
      // Only process top-level class definitions
      if (node.type === "class_definition" && depth <= 1) {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        const name = nameNode.text;
        const bases = extractClassBases(node);
        const bodyNode = node.childForFieldName("body");

        // Check if it's an Enum
        const isEnum = bases?.some(b => b.includes("Enum"));

        types.push({
          name,
          type: isEnum ? "enum" : "class",
          line: getLineNumber(node),
          extends: bases,
          methods: bodyNode ? extractMethods(bodyNode) : undefined,
          properties: bodyNode ? extractProperties(bodyNode) : undefined,
        });
      }

      // Traverse children (increment depth for nested classes)
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const newDepth = node.type === "class_definition" ? depth + 1 : depth;
          traverse(child, newDepth);
        }
      }
    }

    traverse(rootNode);
    return types;
  } catch (error) {
    console.error("Python type parsing error:", error);
    return [];
  }
}

/**
 * Extract function definitions from Python code
 */
export function extractFunctions(code: string): Method[] {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    const functions: Method[] = [];

    function getLineNumber(node: Parser.SyntaxNode): number {
      return node.startPosition.row + 1;
    }

    function traverse(node: Parser.SyntaxNode, depth: number = 0) {
      // Only extract top-level functions (not class methods)
      if (node.type === "function_definition" && depth === 0) {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        const name = nameNode.text;
        const isAsync = node.children.some(c => c.type === "async");
        const params = extractParameters(node);
        const returnTypeNode = node.childForFieldName("return_type");

        functions.push({
          name,
          parameters: params,
          returnType: returnTypeNode?.text,
          isAsync,
        });
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const newDepth = node.type === "class_definition" ? depth + 1 : depth;
          traverse(child, newDepth);
        }
      }
    }

    traverse(rootNode);
    return functions;
  } catch (error) {
    console.error("Python function parsing error:", error);
    return [];
  }
}

/**
 * Extract exports from Python code
 * In Python, exports are defined by __all__ or by convention (non-private top-level definitions)
 */
export function extractExports(code: string): Export[] {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    const exports: Export[] = [];
    let hasAllDefined = false;

    function getLineNumber(node: Parser.SyntaxNode): number {
      return node.startPosition.row + 1;
    }

    // First, check for __all__ definition
    function traverse(node: Parser.SyntaxNode) {
      if (node.type === "assignment") {
        const left = node.childForFieldName("left");
        if (left?.text === "__all__") {
          hasAllDefined = true;
          const right = node.childForFieldName("right");

          // Extract names from list
          if (right?.type === "list") {
            for (let i = 0; i < right.childCount; i++) {
              const child = right.child(i);
              if (child?.type === "string") {
                // Remove quotes
                const name = child.text.replace(/['"]/g, "");
                exports.push({
                  name,
                  type: "named",
                  line: getLineNumber(child),
                });
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    traverse(rootNode);

    // If __all__ not defined, export all public top-level definitions
    if (!hasAllDefined) {
      for (let i = 0; i < rootNode.childCount; i++) {
        const child = rootNode.child(i);
        if (!child) continue;

        // Functions
        if (child.type === "function_definition") {
          const nameNode = child.childForFieldName("name");
          if (nameNode && !nameNode.text.startsWith("_")) {
            exports.push({
              name: nameNode.text,
              type: "named",
              line: getLineNumber(child),
            });
          }
        }

        // Classes
        if (child.type === "class_definition") {
          const nameNode = child.childForFieldName("name");
          if (nameNode && !nameNode.text.startsWith("_")) {
            exports.push({
              name: nameNode.text,
              type: "named",
              line: getLineNumber(child),
            });
          }
        }

        // Top-level constants (ALL_CAPS variables)
        if (child.type === "expression_statement") {
          const assignment = child.child(0);
          if (assignment?.type === "assignment") {
            const left = assignment.childForFieldName("left");
            if (left?.type === "identifier") {
              const name = left.text;
              // Export if ALL_CAPS
              if (name === name.toUpperCase() && name.length > 1) {
                exports.push({
                  name,
                  type: "named",
                  line: getLineNumber(child),
                });
              }
            }
          }
        }
      }
    }

    return exports;
  } catch (error) {
    console.error("Python export parsing error:", error);
    return [];
  }
}

/**
 * Helper function to extract parameters from a function definition
 */
function extractParameters(funcNode: Parser.SyntaxNode): Parameter[] {
  const parameters: Parameter[] = [];
  const paramsNode = funcNode.childForFieldName("parameters");
  if (!paramsNode) return parameters;

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    // Skip self and cls
    if (child.type === "identifier" && (child.text === "self" || child.text === "cls")) {
      continue;
    }

    // Typed parameter: name: type
    if (child.type === "typed_parameter") {
      const nameNode = child.child(0);
      const typeNode = child.childForFieldName("type");
      if (nameNode) {
        parameters.push({
          name: nameNode.text,
          type: typeNode?.text,
        });
      }
    }

    // Default parameter: name = value
    if (child.type === "default_parameter") {
      const nameNode = child.child(0);
      const valueNode = child.childForFieldName("value");

      // Check if it's typed: name: type = value
      let type: string | undefined;
      if (nameNode?.type === "typed_parameter") {
        const actualName = nameNode.child(0);
        const typeNode = nameNode.childForFieldName("type");
        type = typeNode?.text;

        if (actualName) {
          parameters.push({
            name: actualName.text,
            type,
            defaultValue: valueNode?.text,
            optional: true,
          });
        }
      } else if (nameNode) {
        parameters.push({
          name: nameNode.text,
          defaultValue: valueNode?.text,
          optional: true,
        });
      }
    }

    // Simple parameter: name
    if (child.type === "identifier" && child.text !== "self" && child.text !== "cls") {
      // Make sure this isn't part of a typed or default parameter
      const parent = child.parent;
      if (parent?.type === "parameters") {
        parameters.push({
          name: child.text,
        });
      }
    }
  }

  return parameters;
}

/**
 * Check if a Python function is async
 */
export function isPythonFunctionAsync(code: string, functionName: string): boolean {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    function traverse(node: Parser.SyntaxNode): boolean {
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode?.text === functionName) {
          return node.children.some(c => c.type === "async");
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && traverse(child)) return true;
      }

      return false;
    }

    return traverse(rootNode);
  } catch (error) {
    console.error("Python parsing error:", error);
    return false;
  }
}
