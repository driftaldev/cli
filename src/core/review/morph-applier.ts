import { MorphClient } from "@morphllm/morphsdk";
import { fetchMorphCredentials } from "../../utils/morph-credentials.js";
import { logger } from "../../utils/logger.js";

/**
 * MorphApplier class handles semantic code patching using Morph's Fast Apply SDK
 * Documentation: https://docs.morphllm.com/sdk/components/fast-apply
 */
export class MorphApplier {
  private morphClient: MorphClient;

  constructor(apiKey: string) {
    this.morphClient = new MorphClient({ apiKey });
  }

  /**
   * Create a MorphApplier instance by fetching credentials from the backend
   * This is the preferred method for authenticated CLI usage
   */
  static async fromBackend(): Promise<MorphApplier> {
    try {
      const credentials = await fetchMorphCredentials();
      return new MorphApplier(credentials.api_key);
    } catch (error) {
      logger.error("Failed to fetch Morph credentials", error);
      throw error;
    }
  }

  /**
   * Apply a code fix suggestion directly to a file using Morph's Fast Apply
   * @param absoluteFilePath The absolute path to the file to modify
   * @param fixSuggestion The fix suggestion with context markers (lazy edit format)
   * @param instructions Description of what changes are being made
   * @returns Success status and change statistics
   */
  async applyFixToFile(
    absoluteFilePath: string,
    fixSuggestion: string,
    instructions: string
  ): Promise<{
    success: boolean;
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
    udiff?: string;
  }> {
    try {
      logger.debug("Applying fix using Morph Fast Apply", {
        absoluteFilePath,
      });

      // Use Morph's fastApply.execute() method
      // Pass absolute path directly - no baseDir manipulation
      const result = await this.morphClient.fastApply.execute({
        target_filepath: absoluteFilePath,
        instructions: instructions,
        code_edit: fixSuggestion,
      });

      if (!result.success) {
        throw new Error(result.error || "Fast Apply failed");
      }

      logger.debug("Fix applied successfully", {
        linesAdded: result.changes.linesAdded,
        linesRemoved: result.changes.linesRemoved,
        linesModified: result.changes.linesModified,
      });

      return {
        success: true,
        linesAdded: result.changes.linesAdded,
        linesRemoved: result.changes.linesRemoved,
        linesModified: result.changes.linesModified,
        udiff: result.udiff,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("Morph Fast Apply failed", error);
      throw new Error(`Failed to apply fix using Morph: ${errorMessage}`);
    }
  }
}
