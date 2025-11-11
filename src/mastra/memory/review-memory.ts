import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { ReviewIssue, ReviewResults } from "../../core/review/issue.js";

export interface ReviewMemoryEntry {
  id: string;
  timestamp: number;
  fileName: string;
  fileHash: string;
  issue: ReviewIssue;
  userFeedback?: "accepted" | "rejected" | "fixed";
  repoPath: string;
}

export interface LearningPattern {
  pattern: string;
  confidence: number;
  occurrences: number;
  acceptanceRate: number;
  lastSeen: number;
}

/**
 * Semantic memory system for code reviews
 * Learns from past reviews and user feedback
 */
export class ReviewMemory {
  private storageDir: string;
  private memoryFile: string;
  private patternsFile: string;
  private enabled: boolean;

  constructor(storageDir: string = ".driftal/memory", enabled: boolean = true) {
    this.storageDir = storageDir;
    this.memoryFile = path.join(storageDir, "review-memory.json");
    this.patternsFile = path.join(storageDir, "learned-patterns.json");
    this.enabled = enabled;
  }

  /**
   * Initialize memory storage
   */
  async initialize(): Promise<void> {
    if (!this.enabled) return;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });

      // Create files if they don't exist
      try {
        await fs.access(this.memoryFile);
      } catch {
        await fs.writeFile(this.memoryFile, JSON.stringify([], null, 2));
      }

      try {
        await fs.access(this.patternsFile);
      } catch {
        await fs.writeFile(this.patternsFile, JSON.stringify([], null, 2));
      }
    } catch (error) {
      console.error("Failed to initialize review memory:", error);
    }
  }

  /**
   * Store a review result in memory
   */
  async storeReview(
    results: ReviewResults,
    repoPath: string,
    fileName: string
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const memory = await this.loadMemory();
      const fileHash = this.hashFile(fileName);

      for (const issue of results.issues) {
        const entry: ReviewMemoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          fileName,
          fileHash,
          issue,
          repoPath,
        };

        memory.push(entry);
      }

      // Keep only last 1000 entries
      if (memory.length > 1000) {
        memory.splice(0, memory.length - 1000);
      }

      await fs.writeFile(this.memoryFile, JSON.stringify(memory, null, 2));
    } catch (error) {
      console.error("Failed to store review in memory:", error);
    }
  }

  /**
   * Record user feedback on an issue
   */
  async recordFeedback(
    issueId: string,
    feedback: "accepted" | "rejected" | "fixed"
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const memory = await this.loadMemory();
      const entry = memory.find((e) => e.id === issueId);

      if (entry) {
        entry.userFeedback = feedback;
        await fs.writeFile(this.memoryFile, JSON.stringify(memory, null, 2));

        // Update learned patterns
        await this.updatePatterns(entry);
      }
    } catch (error) {
      console.error("Failed to record feedback:", error);
    }
  }

  /**
   * Find similar past issues
   */
  async findSimilarIssues(
    fileName: string,
    issueType: string,
    limit: number = 5
  ): Promise<ReviewMemoryEntry[]> {
    if (!this.enabled) return [];

    try {
      const memory = await this.loadMemory();

      // Filter by file name pattern and issue type
      const similar = memory
        .filter((entry) => {
          const sameType = entry.issue.type === issueType;
          const similarFile = this.areSimilarFiles(fileName, entry.fileName);
          return sameType && similarFile;
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      return similar;
    } catch (error) {
      console.error("Failed to find similar issues:", error);
      return [];
    }
  }

  /**
   * Get acceptance rate for a specific issue pattern
   */
  async getAcceptanceRate(
    issueType: string,
    severity: string
  ): Promise<number> {
    if (!this.enabled) return 0.5;

    try {
      const memory = await this.loadMemory();
      const relevantIssues = memory.filter(
        (e) => e.issue.type === issueType && e.issue.severity === severity
      );

      if (relevantIssues.length === 0) return 0.5;

      const withFeedback = relevantIssues.filter((e) => e.userFeedback);
      if (withFeedback.length === 0) return 0.5;

      const accepted = withFeedback.filter(
        (e) => e.userFeedback === "accepted" || e.userFeedback === "fixed"
      ).length;

      return accepted / withFeedback.length;
    } catch (error) {
      console.error("Failed to get acceptance rate:", error);
      return 0.5;
    }
  }

  /**
   * Get learned patterns for a repository
   */
  async getLearnedPatterns(repoPath?: string): Promise<LearningPattern[]> {
    if (!this.enabled) return [];

    try {
      const patterns = await this.loadPatterns();

      if (repoPath) {
        // Filter patterns by repo if specified
        // For now, return all patterns
        return patterns;
      }

      return patterns;
    } catch (error) {
      console.error("Failed to get learned patterns:", error);
      return [];
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{
    totalReviews: number;
    withFeedback: number;
    acceptanceRate: number;
    topIssueTypes: Array<{ type: string; count: number }>;
  }> {
    if (!this.enabled) {
      return {
        totalReviews: 0,
        withFeedback: 0,
        acceptanceRate: 0,
        topIssueTypes: [],
      };
    }

    try {
      const memory = await this.loadMemory();
      const withFeedback = memory.filter((e) => e.userFeedback);
      const accepted = withFeedback.filter(
        (e) => e.userFeedback === "accepted" || e.userFeedback === "fixed"
      );

      // Count issue types
      const typeCounts = new Map<string, number>();
      for (const entry of memory) {
        const type = entry.issue.type;
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }

      const topIssueTypes = Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        totalReviews: memory.length,
        withFeedback: withFeedback.length,
        acceptanceRate:
          withFeedback.length > 0 ? accepted.length / withFeedback.length : 0,
        topIssueTypes,
      };
    } catch (error) {
      console.error("Failed to get stats:", error);
      return {
        totalReviews: 0,
        withFeedback: 0,
        acceptanceRate: 0,
        topIssueTypes: [],
      };
    }
  }

  /**
   * Clear all memory
   */
  async clear(): Promise<void> {
    if (!this.enabled) return;

    try {
      await fs.writeFile(this.memoryFile, JSON.stringify([], null, 2));
      await fs.writeFile(this.patternsFile, JSON.stringify([], null, 2));
    } catch (error) {
      console.error("Failed to clear memory:", error);
    }
  }

  /**
   * Load memory from storage
   */
  private async loadMemory(): Promise<ReviewMemoryEntry[]> {
    try {
      const data = await fs.readFile(this.memoryFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Load learned patterns
   */
  private async loadPatterns(): Promise<LearningPattern[]> {
    try {
      const data = await fs.readFile(this.patternsFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Update learned patterns based on feedback
   */
  private async updatePatterns(entry: ReviewMemoryEntry): Promise<void> {
    try {
      const patterns = await this.loadPatterns();

      const pattern = `${entry.issue.type}:${entry.issue.severity}`;
      let existing = patterns.find((p) => p.pattern === pattern);

      if (!existing) {
        existing = {
          pattern,
          confidence: 0.5,
          occurrences: 0,
          acceptanceRate: 0,
          lastSeen: Date.now(),
        };
        patterns.push(existing);
      }

      existing.occurrences++;
      existing.lastSeen = Date.now();

      // Update acceptance rate
      if (entry.userFeedback) {
        const accepted =
          entry.userFeedback === "accepted" || entry.userFeedback === "fixed";
        existing.acceptanceRate =
          (existing.acceptanceRate * (existing.occurrences - 1) +
            (accepted ? 1 : 0)) /
          existing.occurrences;

        // Adjust confidence based on acceptance
        existing.confidence = Math.min(
          0.95,
          existing.acceptanceRate * 0.9 + 0.1
        );
      }

      await fs.writeFile(this.patternsFile, JSON.stringify(patterns, null, 2));
    } catch (error) {
      console.error("Failed to update patterns:", error);
    }
  }

  /**
   * Hash a file path for comparison
   */
  private hashFile(filePath: string): string {
    return crypto.createHash("md5").update(filePath).digest("hex");
  }

  /**
   * Check if two file paths are similar (same extension, similar structure)
   */
  private areSimilarFiles(file1: string, file2: string): boolean {
    const ext1 = path.extname(file1);
    const ext2 = path.extname(file2);

    if (ext1 !== ext2) return false;

    // Check if they're in similar directories
    const parts1 = file1.split(path.sep);
    const parts2 = file2.split(path.sep);

    // Same directory depth is a good indicator
    return Math.abs(parts1.length - parts2.length) <= 1;
  }
}
