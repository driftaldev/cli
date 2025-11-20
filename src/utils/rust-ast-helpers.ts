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
