import { z } from "zod";

/**
 * Zod schemas for structured LLM output from review agents
 * These ensure the LLM returns properly formatted JSON that matches our ReviewIssue interface
 */

// Base enums
const IssueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const IssueTypeSchema = z.enum(['bug', 'security', 'performance', 'style', 'best-practice']);

// Location schema
const LocationSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  endLine: z.number().optional(),
});

// Suggestion schema
const SuggestionSchema = z.object({
  description: z.string(),
  originalCode: z.string().optional(),
  fixedCode: z.string().optional(),
  code: z.string().optional(),
  diff: z.string().optional(),
});

// Base issue schema - common fields for all issue types
const BaseIssueSchema = z.object({
  type: IssueTypeSchema,
  severity: IssueSeveritySchema,
  title: z.string(),
  description: z.string(),
  location: LocationSchema,
  suggestion: SuggestionSchema.optional(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).optional().default([]),
  references: z.array(z.string()).optional(),
});

// Security-specific issue schema
const SecurityIssueSchema = BaseIssueSchema.extend({
  type: z.literal('security'),
  cwe: z.string().optional(), // CWE identifier (e.g., "CWE-89")
});

// Performance-specific issue schema
const PerformanceIssueSchema = BaseIssueSchema.extend({
  type: z.literal('performance'),
  complexity: z.string().optional(), // Time/space complexity (e.g., "O(n²)")
  impact: z.enum(['high', 'medium', 'low']).optional(),
  alternative: z.string().optional(), // Better approach or algorithm
});

// Logic/Bug-specific issue schema
const LogicIssueSchema = BaseIssueSchema.extend({
  type: z.literal('bug'),
  problematicPath: z.string().optional(), // The code path that triggers the bug
  edgeCases: z.array(z.string()).optional(), // List of edge cases that expose the bug
});

// Response schemas for each agent type
export const SecurityIssuesResponseSchema = z.object({
  issues: z.array(SecurityIssueSchema),
});

export const PerformanceIssuesResponseSchema = z.object({
  issues: z.array(PerformanceIssueSchema),
});

export const LogicIssuesResponseSchema = z.object({
  issues: z.array(LogicIssueSchema),
});

// Type exports for TypeScript
export type SecurityIssuesResponse = z.infer<typeof SecurityIssuesResponseSchema>;
export type PerformanceIssuesResponse = z.infer<typeof PerformanceIssuesResponseSchema>;
export type LogicIssuesResponse = z.infer<typeof LogicIssuesResponseSchema>;

