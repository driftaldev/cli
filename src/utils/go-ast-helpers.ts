import Parser from "tree-sitter";
import Go from "tree-sitter-go";
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
 * Go AST-based code analysis utilities
 * Uses tree-sitter-go for proper parsing instead of regex matching
 */

// Initialize parser
let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Go);
  }
  return parser;
}

/**
 * Extract all import statements from Go code
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
      // Handle import declarations
      if (node.type === "import_declaration") {
        // Single import or import spec
        const importSpec = node.child(1); // After "import" keyword

        if (importSpec?.type === "import_spec") {
          processImportSpec(importSpec, getLineNumber(node));
        } else if (importSpec?.type === "import_spec_list") {
          // Multiple imports in parentheses
          for (let i = 0; i < importSpec.childCount; i++) {
            const spec = importSpec.child(i);
            if (spec?.type === "import_spec") {
              processImportSpec(spec, getLineNumber(spec));
            }
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    function processImportSpec(spec: Parser.SyntaxNode, line: number) {
      let alias: string | undefined;
      let packagePath = "";

      for (let i = 0; i < spec.childCount; i++) {
        const child = spec.child(i);
        if (!child) continue;

        // Check for alias (package_identifier or . or _)
        if (child.type === "package_identifier" || child.type === "dot" || child.type === "blank_identifier") {
          alias = child.text;
        }

        // Extract package path from interpreted_string_literal or raw_string_literal
        if (child.type === "interpreted_string_literal" || child.type === "raw_string_literal") {
          // Remove quotes
          packagePath = child.text.replace(/^["`]|["`]$/g, "");
        }
      }

      if (packagePath) {
        const packageName = packagePath.split("/").pop() || packagePath;

        if (alias === ".") {
          // Dot import - imports into current namespace
          imports.push({
            source: packagePath,
            items: [],
            alias: ".",
            line,
          });
        } else if (alias === "_") {
          // Blank import - for side effects only
          imports.push({
            source: packagePath,
            items: [],
            alias: "_",
            line,
          });
        } else if (alias) {
          // Aliased import
          imports.push({
            source: packagePath,
            items: [{ name: packageName, alias }],
            alias,
            line,
          });
        } else {
          // Regular import
          imports.push({
            source: packagePath,
            items: [{ name: packageName }],
            line,
          });
        }
      }
    }

    traverse(rootNode);
    return imports;
  } catch (error) {
    console.error("Go import parsing error:", error);
    return [];
  }
}

/**
 * Extract type definitions (structs, interfaces, type aliases) from Go code
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

    function extractStructFields(structType: Parser.SyntaxNode): Property[] {
      const properties: Property[] = [];
      const fieldDeclList = structType.childForFieldName("field_declaration_list");

      if (!fieldDeclList) return properties;

      for (let i = 0; i < fieldDeclList.childCount; i++) {
        const child = fieldDeclList.child(i);
        if (child?.type === "field_declaration") {
          // Get field name(s)
          const nameNode = child.childForFieldName("name");
          const typeNode = child.childForFieldName("type");

          if (nameNode && typeNode) {
            // Could be multiple field names: a, b int
            const names = nameNode.text.split(",").map(n => n.trim());
            for (const name of names) {
              properties.push({
                name,
                type: typeNode.text,
              });
            }
          } else if (typeNode) {
            // Embedded field (anonymous)
            properties.push({
              name: typeNode.text,
              type: typeNode.text,
            });
          }
        }
      }

      return properties;
    }

    function extractInterfaceMethods(interfaceType: Parser.SyntaxNode): Method[] {
      const methods: Method[] = [];
      const methodDeclList = interfaceType.childForFieldName("method_spec_list");

      if (!methodDeclList) return methods;

      for (let i = 0; i < methodDeclList.childCount; i++) {
        const child = methodDeclList.child(i);
        if (child?.type === "method_spec") {
          const nameNode = child.childForFieldName("name");
          const paramsNode = child.childForFieldName("parameters");
          const resultNode = child.childForFieldName("result");

          if (nameNode) {
            methods.push({
              name: nameNode.text,
              parameters: paramsNode ? extractParameters(paramsNode) : [],
              returnType: resultNode?.text,
            });
          }
        }
      }

      return methods;
    }

    function traverse(node: Parser.SyntaxNode) {
      // Handle type declarations
      if (node.type === "type_declaration") {
        // Could be a type_spec or type_spec_list
        const spec = node.child(1); // After "type" keyword

        if (spec?.type === "type_spec") {
          processTypeSpec(spec);
        } else if (spec?.type === "type_alias_list") {
          for (let i = 0; i < spec.childCount; i++) {
            const typeSpec = spec.child(i);
            if (typeSpec?.type === "type_spec") {
              processTypeSpec(typeSpec);
            }
          }
        }
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverse(child);
      }
    }

    function processTypeSpec(spec: Parser.SyntaxNode) {
      const nameNode = spec.childForFieldName("name");
      const typeNode = spec.childForFieldName("type");

      if (!nameNode || !typeNode) return;

      const name = nameNode.text;
      const line = getLineNumber(spec);

      // Check type kind
      if (typeNode.type === "struct_type") {
        types.push({
          name,
          type: "struct",
          line,
          properties: extractStructFields(typeNode),
        });
      } else if (typeNode.type === "interface_type") {
        types.push({
          name,
          type: "interface",
          line,
          methods: extractInterfaceMethods(typeNode),
        });
      } else {
        // Type alias
        types.push({
          name,
          type: "type",
          line,
        });
      }
    }

    traverse(rootNode);
    return types;
  } catch (error) {
    console.error("Go type parsing error:", error);
    return [];
  }
}

/**
 * Extract function and method definitions from Go code
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

    function traverse(node: Parser.SyntaxNode) {
      if (node.type === "function_declaration" || node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        const paramsNode = node.childForFieldName("parameters");
        const resultNode = node.childForFieldName("result");
        const receiverNode = node.childForFieldName("receiver");

        if (nameNode) {
          const params = paramsNode ? extractParameters(paramsNode) : [];

          // Add receiver as first parameter for methods
          if (receiverNode) {
            const receiverParams = extractParameters(receiverNode);
            params.unshift(...receiverParams);
          }

          functions.push({
            name: nameNode.text,
            parameters: params,
            returnType: resultNode?.text,
            isStatic: !receiverNode, // Methods have receivers, functions don't
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
    console.error("Go function parsing error:", error);
    return [];
  }
}

/**
 * Extract exports from Go code
 * In Go, any identifier starting with an uppercase letter is exported
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

    function isExported(name: string): boolean {
      return name.length > 0 && name[0] === name[0].toUpperCase();
    }

    function traverse(node: Parser.SyntaxNode) {
      // Exported functions
      if (node.type === "function_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode && isExported(nameNode.text)) {
          exports.push({
            name: nameNode.text,
            type: "named",
            line: getLineNumber(node),
          });
        }
      }

      // Exported methods
      if (node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode && isExported(nameNode.text)) {
          exports.push({
            name: nameNode.text,
            type: "named",
            line: getLineNumber(node),
          });
        }
      }

      // Exported types
      if (node.type === "type_spec") {
        const nameNode = node.childForFieldName("name");
        if (nameNode && isExported(nameNode.text)) {
          exports.push({
            name: nameNode.text,
            type: "named",
            line: getLineNumber(node),
          });
        }
      }

      // Exported variables and constants
      if (node.type === "var_declaration" || node.type === "const_declaration") {
        // Look for var_spec or const_spec children
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === "var_spec" || child?.type === "const_spec") {
            const nameNode = child.childForFieldName("name");
            if (nameNode && isExported(nameNode.text)) {
              exports.push({
                name: nameNode.text,
                type: "named",
                line: getLineNumber(child),
              });
            }
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
    console.error("Go export parsing error:", error);
    return [];
  }
}

/**
 * Helper function to extract parameters from parameter list
 */
function extractParameters(paramsNode: Parser.SyntaxNode): Parameter[] {
  const parameters: Parameter[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child || child.type !== "parameter_declaration") continue;

    // Get name and type
    const nameNode = child.childForFieldName("name");
    const typeNode = child.childForFieldName("type");

    // Go allows: (a, b int) where multiple params share one type
    if (nameNode && typeNode) {
      // Could be multiple names: a, b, c
      const names = nameNode.text.split(",").map(n => n.trim());
      for (const name of names) {
        parameters.push({
          name,
          type: typeNode.text,
        });
      }
    } else if (typeNode) {
      // Unnamed parameter (just type)
      parameters.push({
        name: "",
        type: typeNode.text,
      });
    }
  }

  return parameters;
}

/**
 * Check if a Go function is a method (has a receiver)
 */
export function isGoMethod(code: string, functionName: string): boolean {
  try {
    const parser = getParser();
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    function traverse(node: Parser.SyntaxNode): boolean {
      if (node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode?.text === functionName) {
          const receiverNode = node.childForFieldName("receiver");
          return !!receiverNode;
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
    console.error("Go parsing error:", error);
    return false;
  }
}
