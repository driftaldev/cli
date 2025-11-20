import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";

/**
 * Rust AST-based code analysis utilities
 * Uses tree-sitter-rust for proper parsing instead of string matching
 */

// Initialize parser
let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Rust);
  }
  return parser;
}

/**
 * Check if a Rust function is async
 * @param code Rust source code
 * @param functionName Name of the function to check
 * @returns true if the function is async
 */
export function isRustFunctionAsync(code: string, functionName: string): boolean {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    let isAsync = false;

    function traverse(node: Parser.SyntaxNode) {
      // Look for function items
      if (node.type === "function_item") {
        // Get the function name
        const nameNode = node.childForFieldName("name");
        if (nameNode && nameNode.text === functionName) {
          // Check if it has async modifier
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && (child.type === "async" || child.text === "async")) {
              isAsync = true;
              return;
            }
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    }

    traverse(rootNode);
    return isAsync;
  } catch (error) {
    // If parsing fails, return false
    console.error("Rust parsing error:", error);
    return false;
  }
}

/**
 * Check if a Rust function/method is public
 * @param code Rust source code
 * @param functionName Name of the function/method to check
 * @returns true if the function is public
 */
export function isRustFunctionPublic(code: string, functionName: string): boolean {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    let isPublic = false;

    function traverse(node: Parser.SyntaxNode) {
      // Look for function items
      if (node.type === "function_item") {
        // Get the function name
        const nameNode = node.childForFieldName("name");
        if (nameNode && nameNode.text === functionName) {
          // Check for visibility modifier
          // In Rust, functions are private by default unless marked with pub
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === "visibility_modifier") {
              // Check if it contains "pub"
              if (child.text.includes("pub")) {
                isPublic = true;
                return;
              }
            }
          }
          // If we found the function but no pub modifier, it's private
          return;
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    }

    traverse(rootNode);
    return isPublic;
  } catch (error) {
    console.error("Rust parsing error:", error);
    return false;
  }
}

/**
 * Get function modifiers (async, pub, etc.) from Rust code
 * @param code Rust source code snippet containing a function
 * @returns Object with async and visibility properties
 */
export function getRustFunctionModifiers(code: string, functionName: string): {
  isAsync: boolean;
  visibility: "public" | "private" | "pub(crate)" | "pub(super)";
} {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    let result = {
      isAsync: false,
      visibility: "private" as "public" | "private" | "pub(crate)" | "pub(super)"
    };

    function traverse(node: Parser.SyntaxNode) {
      // Look for function items
      if (node.type === "function_item") {
        // Get the function name
        const nameNode = node.childForFieldName("name");
        if (nameNode && nameNode.text === functionName) {
          // Check all children for modifiers
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;

            // Check for async
            if (child.type === "async" || child.text === "async") {
              result.isAsync = true;
            }

            // Check for visibility
            if (child.type === "visibility_modifier") {
              const visText = child.text;
              if (visText === "pub") {
                result.visibility = "public";
              } else if (visText === "pub(crate)") {
                result.visibility = "pub(crate)";
              } else if (visText === "pub(super)") {
                result.visibility = "pub(super)";
              }
            }
          }
          return;
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    }

    traverse(rootNode);
    return result;
  } catch (error) {
    console.error("Rust parsing error:", error);
    return {
      isAsync: false,
      visibility: "private"
    };
  }
}

// ==================== Comprehensive AST Extraction Functions ====================

/**
 * Extract all use statements (imports) from Rust code
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

    function processUsePath(node: Parser.SyntaxNode, basePath: string = ""): {source: string; items: ImportItem[]} | null {
      if (node.type === "identifier" || node.type === "scoped_identifier") {
        const source = basePath ? `${basePath}::${node.text}` : node.text;
        const name = node.text.split("::").pop() || node.text;
        return { source, items: [{ name }] };
      }

      if (node.type === "use_as_clause") {
        const pathNode = node.child(0);
        const aliasNode = node.childForFieldName("alias");
        if (pathNode && aliasNode) {
          const source = pathNode.text;
          const name = source.split("::").pop() || source;
          return { source, items: [{ name, alias: aliasNode.text }] };
        }
      }

      if (node.type === "use_list") {
        // use module::{Item1, Item2}
        const items: ImportItem[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child || child.type === "{" || child.type === "}" || child.type === ",") continue;

          if (child.type === "identifier") {
            items.push({ name: child.text });
          } else if (child.type === "use_as_clause") {
            const pathNode = child.child(0);
            const aliasNode = child.childForFieldName("alias");
            if (pathNode && aliasNode) {
              items.push({ name: pathNode.text, alias: aliasNode.text });
            }
          }
        }
        return { source: basePath, items };
      }

      if (node.type === "use_wildcard") {
        // use module::*
        return { source: basePath, items: [] };
      }

      return null;
    }

    function traverse(node: Parser.SyntaxNode) {
      // Handle use declarations
      if (node.type === "use_declaration") {
        const pathNode = node.child(1); // After "use" keyword
        if (!pathNode) return;

        let basePath = "";
        let useClause = pathNode;

        // Check if it's a scoped use (use module::{...})
        if (pathNode.type === "scoped_use_list") {
          const scopeNode = pathNode.childForFieldName("path");
          const listNode = pathNode.childForFieldName("list");

          if (scopeNode) {
            basePath = scopeNode.text;
          }
          if (listNode) {
            useClause = listNode;
          }
        }

        const result = processUsePath(useClause, basePath);
        if (result) {
          imports.push({
            source: result.source,
            items: result.items,
            line: getLineNumber(node),
            ...(useClause.type === "use_wildcard" && { alias: "*" }),
          });
        }
      }

      // Handle extern crate
      if (node.type === "extern_crate_declaration") {
        const nameNode = node.childForFieldName("name");
        const aliasNode = node.childForFieldName("alias");
        if (nameNode) {
          imports.push({
            source: nameNode.text,
            items: [{ name: nameNode.text, alias: aliasNode?.text }],
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
    console.error("Rust import parsing error:", error);
    return [];
  }
}

/**
 * Extract type definitions (structs, enums, traits, type aliases) from Rust code
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

    function extractGenericParams(node: Parser.SyntaxNode): string[] | undefined {
      const typeParams = node.childForFieldName("type_parameters");
      if (!typeParams) return undefined;

      const params: string[] = [];
      for (let i = 0; i < typeParams.childCount; i++) {
        const child = typeParams.child(i);
        if (child?.type === "type_identifier" || child?.type === "lifetime") {
          params.push(child.text);
        }
      }
      return params.length > 0 ? params : undefined;
    }

    function extractStructFields(bodyNode: Parser.SyntaxNode): Property[] {
      const properties: Property[] = [];
      for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (child?.type === "field_declaration") {
          const nameNode = child.childForFieldName("name");
          const typeNode = child.childForFieldName("type");
          if (nameNode && typeNode) {
            properties.push({
              name: nameNode.text,
              type: typeNode.text,
            });
          }
        }
      }
      return properties;
    }

    function traverse(node: Parser.SyntaxNode) {
      // Struct declarations
      if (node.type === "struct_item") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        const bodyNode = node.childForFieldName("body");
        types.push({
          name: nameNode.text,
          type: "struct",
          line: getLineNumber(node),
          generics: extractGenericParams(node),
          properties: bodyNode ? extractStructFields(bodyNode) : undefined,
        });
      }

      // Enum declarations
      if (node.type === "enum_item") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        types.push({
          name: nameNode.text,
          type: "enum",
          line: getLineNumber(node),
          generics: extractGenericParams(node),
        });
      }

      // Trait declarations
      if (node.type === "trait_item") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        types.push({
          name: nameNode.text,
          type: "trait",
          line: getLineNumber(node),
          generics: extractGenericParams(node),
        });
      }

      // Type alias declarations
      if (node.type === "type_item") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;

        types.push({
          name: nameNode.text,
          type: "type",
          line: getLineNumber(node),
          generics: extractGenericParams(node),
        });
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    traverse(rootNode);
    return types;
  } catch (error) {
    console.error("Rust type parsing error:", error);
    return [];
  }
}

/**
 * Extract function definitions from Rust code
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

    function extractParameters(paramsNode: Parser.SyntaxNode): Parameter[] {
      const parameters: Parameter[] = [];
      for (let i = 0; i < paramsNode.childCount; i++) {
        const child = paramsNode.child(i);
        if (child?.type === "parameter" || child?.type === "self_parameter") {
          const patternNode = child.childForFieldName("pattern");
          const typeNode = child.childForFieldName("type");

          if (child.type === "self_parameter") {
            parameters.push({
              name: "self",
              type: child.text,
            });
          } else if (patternNode && typeNode) {
            parameters.push({
              name: patternNode.text,
              type: typeNode.text,
            });
          }
        }
      }
      return parameters;
    }

    function extractVisibility(node: Parser.SyntaxNode): "public" | "private" | "protected" {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "visibility_modifier") {
          const visText = child.text;
          if (visText === "pub") return "public";
          if (visText === "pub(crate)") return "public";
          if (visText === "pub(super)") return "protected";
        }
      }
      return "private";
    }

    function isAsync(node: Parser.SyntaxNode): boolean {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "async" || child?.text === "async") {
          return true;
        }
      }
      return false;
    }

    function traverse(node: Parser.SyntaxNode) {
      if (node.type === "function_item") {
        const nameNode = node.childForFieldName("name");
        const paramsNode = node.childForFieldName("parameters");
        const returnTypeNode = node.childForFieldName("return_type");

        if (nameNode) {
          functions.push({
            name: nameNode.text,
            parameters: paramsNode ? extractParameters(paramsNode) : [],
            returnType: returnTypeNode?.text,
            isAsync: isAsync(node),
            visibility: extractVisibility(node),
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
    return functions;
  } catch (error) {
    console.error("Rust function parsing error:", error);
    return [];
  }
}

/**
 * Extract exports from Rust code (pub items)
 */
export function extractExports(code: string): Export[] {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    const exports: Export[] = [];

    function getLineNumber(node: Parser.SyntaxNode): number {
      return node.startPosition.row + 1;
    }

    function hasPublicVisibility(node: Parser.SyntaxNode): boolean {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "visibility_modifier" && child.text.startsWith("pub")) {
          return true;
        }
      }
      return false;
    }

    function traverse(node: Parser.SyntaxNode) {
      // Check for public items
      if (hasPublicVisibility(node)) {
        let name: string | null = null;

        if (node.type === "function_item") {
          name = node.childForFieldName("name")?.text || null;
        } else if (node.type === "struct_item") {
          name = node.childForFieldName("name")?.text || null;
        } else if (node.type === "enum_item") {
          name = node.childForFieldName("name")?.text || null;
        } else if (node.type === "trait_item") {
          name = node.childForFieldName("name")?.text || null;
        } else if (node.type === "type_item") {
          name = node.childForFieldName("name")?.text || null;
        } else if (node.type === "const_item" || node.type === "static_item") {
          name = node.childForFieldName("name")?.text || null;
        }

        if (name) {
          exports.push({
            name,
            type: "named",
            line: getLineNumber(node),
          });
        }
      }

      // Handle pub use (re-exports)
      if (node.type === "use_declaration" && hasPublicVisibility(node)) {
        // Extract the last identifier from the use path
        const pathNode = node.child(1);
        if (pathNode) {
          const text = pathNode.text;
          const parts = text.split("::");
          const name = parts[parts.length - 1];
          if (name && name !== "*") {
            exports.push({
              name,
              type: "named",
              line: getLineNumber(node),
            });
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    traverse(rootNode);
    return exports;
  } catch (error) {
    console.error("Rust export parsing error:", error);
    return [];
  }
}
