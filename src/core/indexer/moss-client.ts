import { MossClient as Moss, DocumentInfo, SearchResult as MossSearchResult } from "@inferedge/moss";
import { Buffer } from "buffer";
import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";

export interface IndexFilePayload {
  path: string;
  content?: string;
  content_base64?: string;
}

export interface FullIndexRequest {
  repo_full_name: string;
  files: IndexFilePayload[];
}

export interface FullIndexResponse {
  status: string;
  repo: string;
  files_indexed: number;
  message?: string;
}

export interface IncrementalIndexRequest {
  repo_full_name: string;
  files?: IndexFilePayload[];
  deleted_files?: string[];
}

export interface IncrementalIndexResponse {
  status: string;
  repo: string;
  files_indexed: number;
  message?: string;
}

export interface WebIndexRequest {
  url: string;
  documents: Array<{ title?: string; url: string; content: string }>;
}

export interface WebIndexResponse {
  status: string;
  url: string;
  docs_indexed: number;
  message?: string;
}

export interface SearchResult {
  repo?: string;
  repo_full_name?: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  content?: string;
  snippet?: string;
  score?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total?: number;
  duration_ms?: number;
  repo?: string;
}

export interface SearchParams {
  query: string;
  repos?: string[];
  file_types?: string[];
  max_results?: number;
}

interface IndexMetadata {
  repo_full_name: string;
  files: Record<string, { hash: string; chunks: string[] }>;
  created_at: string;
  updated_at: string;
}

const CHUNK_SIZE = 2000; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks

export class MossClient {
  private moss: Moss;
  private indexDir: string;

  constructor(
    projectId?: string,
    projectKey?: string,
    indexDirectory: string = ".scout-code/indexes"
  ) {
    // Get Moss credentials from: 1) parameters, 2) environment variables
    const id = projectId || process.env.MOSS_PROJECT_ID || process.env.PROJECT_ID;
    const key = projectKey || process.env.MOSS_PROJECT_KEY || process.env.PROJECT_KEY;

    if (!id || !key) {
      throw new Error(
        "Moss credentials not found. Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY environment variables.\n" +
        "Or pass projectId and projectKey to constructor.\n" +
        "Get your credentials from: https://usemoss.dev"
      );
    }

    this.moss = new Moss(id, key);
    this.indexDir = path.resolve(process.cwd(), indexDirectory);
  }

  private async ensureIndexDir(): Promise<void> {
    await fs.mkdir(this.indexDir, { recursive: true });
  }

  private getMetadataPath(indexName: string): string {
    return path.join(this.indexDir, `${indexName}.meta.json`);
  }

  private async loadMetadata(indexName: string): Promise<IndexMetadata | null> {
    try {
      const metaPath = this.getMetadataPath(indexName);
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async saveMetadata(indexName: string, metadata: IndexMetadata): Promise<void> {
    const metaPath = this.getMetadataPath(indexName);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  private hashContent(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private chunkText(text: string, filePath: string, chunkIndex: number): { id: string; text: string; metadata: Record<string, string> } {
    const id = `${filePath}::chunk-${chunkIndex}`;
    return {
      id,
      text,
      metadata: {
        file_path: filePath,
        chunk_index: String(chunkIndex)
      }
    };
  }

  private splitIntoChunks(content: string, filePath: string): DocumentInfo[] {
    const chunks: DocumentInfo[] = [];
    const lines = content.split("\n");
    let currentChunk = "";
    let currentLineStart = 0;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const proposedChunk = currentChunk + (currentChunk ? "\n" : "") + line;

      if (proposedChunk.length > CHUNK_SIZE && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          ...this.chunkText(currentChunk, filePath, chunkIndex),
          metadata: {
            file_path: filePath,
            chunk_index: String(chunkIndex),
            line_start: String(currentLineStart),
            line_end: String(i - 1)
          }
        });
        chunkIndex++;

        // Start new chunk with overlap
        const overlapLines = Math.min(5, Math.floor(CHUNK_OVERLAP / 50)); // ~50 chars per line avg
        const startIdx = Math.max(0, i - overlapLines);
        currentChunk = lines.slice(startIdx, i + 1).join("\n");
        currentLineStart = startIdx;
      } else {
        currentChunk = proposedChunk;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        ...this.chunkText(currentChunk, filePath, chunkIndex),
        metadata: {
          file_path: filePath,
          chunk_index: String(chunkIndex),
          line_start: String(currentLineStart),
          line_end: String(lines.length - 1)
        }
      });
    }

    return chunks;
  }

  async fullIndex(payload: FullIndexRequest): Promise<FullIndexResponse> {
    await this.ensureIndexDir();

    const indexName = payload.repo_full_name.replace(/\//g, "_");
    const allDocs: DocumentInfo[] = [];
    const fileMetadata: Record<string, { hash: string; chunks: string[] }> = {};

    console.log(`Indexing ${payload.files.length} files for ${payload.repo_full_name}...`);

    for (const file of payload.files) {
      // Handle both content and content_base64
      const content = file.content || (file.content_base64 ? Buffer.from(file.content_base64, "base64").toString("utf-8") : "");

      if (!content) {
        console.warn(`Skipping file ${file.path}: no content provided`);
        continue;
      }

      const hash = this.hashContent(content);
      const chunks = this.splitIntoChunks(content, file.path);

      allDocs.push(...chunks);
      fileMetadata[file.path] = {
        hash,
        chunks: chunks.map(c => c.id)
      };
    }

    try {
      // Try to delete existing index if it exists
      try {
        await this.moss.deleteIndex(indexName);
      } catch {
        // Index doesn't exist, that's fine
      }

      // Create new index
      await this.moss.createIndex(indexName, allDocs, "moss-minilm");

      // Save metadata
      const metadata: IndexMetadata = {
        repo_full_name: payload.repo_full_name,
        files: fileMetadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await this.saveMetadata(indexName, metadata);

      console.log(`Successfully indexed ${allDocs.length} chunks from ${payload.files.length} files`);

      return {
        status: "success",
        repo: payload.repo_full_name,
        files_indexed: payload.files.length,
        message: `Indexed ${allDocs.length} chunks`
      };
    } catch (error) {
      console.error("Failed to create index:", error);
      throw new Error(`Failed to index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async incrementalIndex(payload: IncrementalIndexRequest): Promise<IncrementalIndexResponse> {
    await this.ensureIndexDir();

    const indexName = payload.repo_full_name.replace(/\//g, "_");
    const metadata = await this.loadMetadata(indexName);

    if (!metadata) {
      throw new Error(`Index not found for ${payload.repo_full_name}. Run full index first.`);
    }

    const docsToAdd: DocumentInfo[] = [];
    const docIdsToDelete: string[] = [];
    let filesProcessed = 0;

    // Handle deleted files
    if (payload.deleted_files?.length) {
      for (const deletedFile of payload.deleted_files) {
        if (metadata.files[deletedFile]) {
          docIdsToDelete.push(...metadata.files[deletedFile].chunks);
          delete metadata.files[deletedFile];
        }
      }
    }

    // Handle updated/new files
    if (payload.files?.length) {
      for (const file of payload.files) {
        // Handle both content and content_base64
        const content = file.content || (file.content_base64 ? Buffer.from(file.content_base64, "base64").toString("utf-8") : "");

        if (!content) {
          console.warn(`Skipping file ${file.path}: no content provided`);
          continue;
        }

        const newHash = this.hashContent(content);
        const existing = metadata.files[file.path];

        // Check if file changed
        if (existing && existing.hash === newHash) {
          continue; // File unchanged, skip
        }

        // Delete old chunks if file existed
        if (existing) {
          docIdsToDelete.push(...existing.chunks);
        }

        // Add new chunks
        const chunks = this.splitIntoChunks(content, file.path);
        docsToAdd.push(...chunks);
        metadata.files[file.path] = {
          hash: newHash,
          chunks: chunks.map(c => c.id)
        };
        filesProcessed++;
      }
    }

    try {
      // Delete old chunks
      if (docIdsToDelete.length > 0) {
        await this.moss.deleteDocs(indexName, docIdsToDelete);
      }

      // Add new chunks
      if (docsToAdd.length > 0) {
        await this.moss.addDocs(indexName, docsToAdd, { upsert: true });
      }

      // Update metadata
      metadata.updated_at = new Date().toISOString();
      await this.saveMetadata(indexName, metadata);

      console.log(`Incremental update: ${filesProcessed} files, ${docsToAdd.length} chunks added, ${docIdsToDelete.length} chunks deleted`);

      return {
        status: "success",
        repo: payload.repo_full_name,
        files_indexed: filesProcessed,
        message: `Updated ${filesProcessed} files`
      };
    } catch (error) {
      console.error("Failed to update index:", error);
      throw new Error(`Failed to update index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteRepo(repo: string): Promise<void> {
    const indexName = repo.replace(/\//g, "_");
    await this.moss.deleteIndex(indexName);

    // Delete metadata
    try {
      await fs.unlink(this.getMetadataPath(indexName));
    } catch {
      // Metadata file might not exist
    }
  }

  private loadedIndexes = new Set<string>();

  async search(params: SearchParams): Promise<SearchResponse> {
    const startTime = Date.now();
    const repos = params.repos && params.repos.length > 0 ? params.repos : [];
    const maxResults = params.max_results ?? 10;

    process.stderr.write(`[MossClient] Searching for: "${params.query}"\n`);
    process.stderr.write(`[MossClient] Max results: ${maxResults}\n`);

    // If no specific repos, search all available indexes
    let indexesToSearch: string[] = [];
    if (repos.length === 0) {
      const allIndexes = await this.moss.listIndexes();
      indexesToSearch = allIndexes.map(idx => idx.name);
      process.stderr.write(`[MossClient] No repos specified, searching ${indexesToSearch.length} available indexes\n`);
    } else {
      indexesToSearch = repos.map(r => r.replace(/\//g, "_"));
      process.stderr.write(`[MossClient] Searching repos: ${repos.join(', ')}\n`);
    }

    const allResults: SearchResult[] = [];

    for (const indexName of indexesToSearch) {
      try {
        // Load the index first before querying (only once per session)
        if (!this.loadedIndexes.has(indexName)) {
          process.stderr.write(`[MossClient] Loading index: ${indexName}...\n`);
          await this.moss.loadIndex(indexName);
          this.loadedIndexes.add(indexName);
          process.stderr.write(`[MossClient] Index loaded! Subsequent queries will be faster.\n`);
        }

        process.stderr.write(`[MossClient] Querying index: ${indexName}\n`);
        process.stderr.write(`[MossClient] Query details:\n`);
        process.stderr.write(`  - Query text: "${params.query}"\n`);
        process.stderr.write(`  - Index: ${indexName}\n`);
        process.stderr.write(`  - Max results: ${maxResults}\n`);

        const queryStart = Date.now();
        const mossResult: MossSearchResult = await this.moss.query(
          indexName,
          params.query,
          maxResults
        );
        const queryDuration = Date.now() - queryStart;

        process.stderr.write(`[MossClient] Query completed in ${queryDuration}ms, found ${mossResult.docs.length} results\n`);

        // Log raw Moss response details
        if (mossResult.docs.length > 0) {
          process.stderr.write(`[MossClient] Raw Moss response (first 3 results):\n`);
          mossResult.docs.slice(0, 3).forEach((doc, idx) => {
            process.stderr.write(`  Result ${idx + 1}:\n`);
            process.stderr.write(`    - Score: ${doc.score}\n`);
            process.stderr.write(`    - File: ${doc.metadata?.file_path || 'N/A'}\n`);
            process.stderr.write(`    - Lines: ${doc.metadata?.line_start || 'N/A'}-${doc.metadata?.line_end || 'N/A'}\n`);
            process.stderr.write(`    - Content preview: ${doc.text.substring(0, 100).replace(/\n/g, ' ')}...\n`);
          });
        }

        // Convert Moss results to our format
        for (const doc of mossResult.docs) {
          const filePath = doc.metadata?.file_path || "";
          const lineStart = doc.metadata?.line_start ? parseInt(doc.metadata.line_start) : undefined;
          const lineEnd = doc.metadata?.line_end ? parseInt(doc.metadata.line_end) : undefined;

          // Try to get repo name from metadata
          const metadata = await this.loadMetadata(indexName);
          const repoName = metadata?.repo_full_name || indexName.replace(/_/g, "/");

          allResults.push({
            repo: repoName,
            repo_full_name: repoName,
            file_path: filePath,
            line_start: lineStart,
            line_end: lineEnd,
            content: doc.text,
            snippet: doc.text.substring(0, 300),
            score: doc.score
          });
        }
      } catch (error) {
        process.stderr.write(`[MossClient] Failed to search index ${indexName}: ${error}\n`);
        // Continue with other indexes
      }
    }

    // Sort by score and limit results
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    const finalResults = allResults.slice(0, maxResults);

    process.stderr.write(`[MossClient] Total results before filtering: ${allResults.length}\n`);
    process.stderr.write(`[MossClient] Results after limiting to ${maxResults}: ${finalResults.length}\n`);

    // Filter by file types if specified
    const filteredResults = params.file_types && params.file_types.length > 0
      ? finalResults.filter(r => {
          const ext = r.file_path?.split(".").pop();
          return ext && params.file_types?.includes(ext);
        })
      : finalResults;

    if (params.file_types && params.file_types.length > 0) {
      process.stderr.write(`[MossClient] Filtered by file types [${params.file_types.join(', ')}]: ${filteredResults.length} results\n`);
    }

    const duration = Date.now() - startTime;
    process.stderr.write(`[MossClient] Search completed in ${duration}ms, returning ${filteredResults.length} results\n`);

    return {
      results: filteredResults,
      total: filteredResults.length,
      duration_ms: duration
    };
  }

  async webIndex(payload: WebIndexRequest): Promise<WebIndexResponse> {
    await this.ensureIndexDir();

    // Create index name from URL
    const urlObj = new URL(payload.url);
    const indexName = `web_${urlObj.hostname.replace(/\./g, "_")}`;

    const docs: DocumentInfo[] = payload.documents.map((doc, idx) => ({
      id: `${doc.url}::${idx}`,
      text: doc.content,
      metadata: {
        url: doc.url,
        title: doc.title || "",
        source: "web"
      }
    }));

    try {
      // Try to delete existing index if it exists
      try {
        await this.moss.deleteIndex(indexName);
      } catch {
        // Index doesn't exist, that's fine
      }

      // Create new index
      await this.moss.createIndex(indexName, docs, "moss-minilm");

      // Save metadata
      const metadata: IndexMetadata = {
        repo_full_name: indexName,
        files: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await this.saveMetadata(indexName, metadata);

      return {
        status: "success",
        url: payload.url,
        docs_indexed: docs.length,
        message: `Indexed ${docs.length} documents from ${payload.url}`
      };
    } catch (error) {
      console.error("Failed to index web content:", error);
      throw new Error(`Failed to index web content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async health(): Promise<boolean> {
    try {
      // Check if Moss is functional by listing indexes
      await this.moss.listIndexes();
      return true;
    } catch {
      return false;
    }
  }

  async isIndexed(repoFullName: string): Promise<boolean> {
    const indexName = repoFullName.replace(/\//g, "_");
    const metadata = await this.loadMetadata(indexName);
    if (!metadata) {
      return false;
    }
    
    // Also verify the index actually exists in Moss
    try {
      const indexes = await this.moss.listIndexes();
      return indexes.some(idx => idx.name === indexName);
    } catch {
      return false;
    }
  }
}
