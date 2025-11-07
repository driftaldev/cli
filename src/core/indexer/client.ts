import { fetch } from "undici";

export interface IndexFilePayload {
  path: string;
  content_base64: string;
}

export interface FullIndexRequest {
  repo_full_name: string;
  files: IndexFilePayload[];
  installation_id?: number;
}

export interface FullIndexResponse {
  status: string;
  repo: string;
  flow_name: string;
  files_indexed: number;
  message?: string;
}

export interface IncrementalIndexRequest {
  repo_full_name: string;
  files?: IndexFilePayload[];
  deleted_files?: string[];
  installation_id?: number;
}

export interface IncrementalIndexResponse {
  status: string;
  repo: string;
  flow_name: string;
  files_indexed: number;
  message?: string;
}

export interface WebIndexRequest {
  url: string;
}

export interface WebIndexResponse {
  status: string;
  url: string;
  crawl_data: unknown;
  database_info?: Record<string, unknown> | null;
  message?: string;
  error?: string | null;
}

export interface SearchResult {
  repo?: string;
  repo_full_name?: string;
  file_path?: string;
  path?: string;
  line_start?: number;
  line_end?: number;
  start_line?: number;
  end_line?: number;
  content?: string;
  snippet?: string;
  summary?: string;
  highlights?: string[];
  score?: number;
  filename?: string;
  location?: string;
  text?: string;
  similarity?: number;
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

type RawSearchResponse =
  | (SearchResponse & {
      repo_full_name?: string;
      duration?: number;
      durationMs?: number;
      durationMS?: number;
      took?: number;
      total_count?: number;
      totalHits?: number;
      count?: number;
      results?: unknown[];
      hits?: unknown[];
      items?: unknown[];
      data?: {
        results?: unknown[];
        hits?: unknown[];
        items?: unknown[];
        total?: number;
        total_count?: number;
        duration_ms?: number;
      };
      meta?: {
        duration_ms?: number;
      };
    })
  | Record<string, unknown>;

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function pickFirstArrayCandidate(...candidates: unknown[]): unknown[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }
  return [];
}

function normalizeSearchResult(
  raw: Record<string, unknown>,
  fallbackRepo?: string
): SearchResult {
  const repoCandidate =
    raw.repo ??
    raw.repo_full_name ??
    raw.repository ??
    raw.owner ??
    fallbackRepo;
  const filePathCandidate =
    raw.file_path ??
    raw.path ??
    (typeof raw.file === "object" && raw.file !== null
      ? (raw.file as Record<string, unknown>).path
      : undefined) ??
    raw.location ??
    raw.filename;

  const startLineCandidate =
    raw.line_start ??
    raw.start_line ??
    raw.startLine ??
    (typeof raw.start === "object" && raw.start !== null
      ? (raw.start as Record<string, unknown>).line
      : undefined) ??
    (typeof raw.range === "object" && raw.range !== null
      ? (raw.range as Record<string, unknown>).start
      : undefined);

  const endLineCandidate =
    raw.line_end ??
    raw.end_line ??
    raw.endLine ??
    (typeof raw.end === "object" && raw.end !== null
      ? (raw.end as Record<string, unknown>).line
      : undefined) ??
    (typeof raw.range === "object" && raw.range !== null
      ? (raw.range as Record<string, unknown>).end
      : undefined);

  const line_start = coerceNumber(startLineCandidate);
  const line_end = coerceNumber(endLineCandidate);

  const score =
    coerceNumber(raw.score) ??
    coerceNumber(raw.similarity) ??
    coerceNumber(raw.rank) ??
    coerceNumber(raw.score_percent) ??
    0;

  const highlightsCandidate = raw.highlights ?? raw.matches ?? raw.fragments;
  const highlights = Array.isArray(highlightsCandidate)
    ? highlightsCandidate.map((item) => String(item))
    : undefined;

  const contentCandidate =
    raw.content ?? raw.text ?? raw.snippet ?? raw.summary ?? raw.body ?? "";

  const snippetCandidate =
    raw.snippet ?? raw.summary ?? raw.text ?? raw.content ?? "";

  return {
    repo: typeof repoCandidate === "string" ? repoCandidate : fallbackRepo,
    repo_full_name:
      typeof raw.repo_full_name === "string"
        ? raw.repo_full_name
        : typeof repoCandidate === "string"
        ? repoCandidate
        : fallbackRepo,
    file_path:
      typeof filePathCandidate === "string" ? filePathCandidate : undefined,
    path:
      typeof (raw.path as string | undefined) === "string"
        ? (raw.path as string)
        : undefined,
    line_start,
    line_end,
    start_line: line_start,
    end_line: line_end,
    content: String(contentCandidate),
    snippet: String(snippetCandidate),
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    highlights,
    score,
    filename:
      typeof raw.filename === "string"
        ? raw.filename
        : typeof raw.name === "string"
        ? raw.name
        : undefined,
    location:
      typeof raw.location === "string"
        ? raw.location
        : typeof filePathCandidate === "string"
        ? filePathCandidate
        : undefined,
    text: typeof raw.text === "string" ? raw.text : String(contentCandidate),
    similarity: coerceNumber(raw.similarity)
  };
}

function normalizeSearchResponse(raw: unknown): SearchResponse {
  if (!raw || typeof raw !== "object") {
    return { results: [] };
  }

  const rawTyped = raw as RawSearchResponse;

  const candidateResults = pickFirstArrayCandidate(
    (rawTyped as { results?: unknown[] }).results,
    (rawTyped as { hits?: unknown[] }).hits,
    (rawTyped as { items?: unknown[] }).items,
    rawTyped.data?.results,
    rawTyped.data?.hits,
    rawTyped.data?.items
  );

  const fallbackRepo =
    typeof (rawTyped as { repo?: unknown }).repo === "string"
      ? (rawTyped as { repo?: string }).repo
      : typeof rawTyped.repo_full_name === "string"
      ? rawTyped.repo_full_name
      : undefined;

  const results = candidateResults.map((item) =>
    normalizeSearchResult(
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : { text: String(item) },
      fallbackRepo
    )
  );

  const total =
    coerceNumber((rawTyped as { total?: unknown }).total) ??
    coerceNumber(rawTyped.total_count) ??
    coerceNumber(rawTyped.totalHits) ??
    coerceNumber(rawTyped.count) ??
    coerceNumber(rawTyped.data?.total) ??
    coerceNumber(rawTyped.data?.total_count) ??
    results.length;

  const duration_ms =
    coerceNumber((rawTyped as { duration_ms?: unknown }).duration_ms) ??
    coerceNumber(rawTyped.duration) ??
    coerceNumber(rawTyped.durationMs) ??
    coerceNumber(rawTyped.durationMS) ??
    coerceNumber(rawTyped.took) ??
    coerceNumber(rawTyped.meta?.duration_ms) ??
    coerceNumber(rawTyped.data?.duration_ms);

  const repo =
    typeof (rawTyped as { repo?: unknown }).repo === "string"
      ? (rawTyped as { repo?: string }).repo
      : typeof rawTyped.repo_full_name === "string"
      ? rawTyped.repo_full_name
      : undefined;

  return {
    results,
    total,
    duration_ms,
    repo
  };
}

export class IndexerClient {
  constructor(
    private readonly baseUrl = "http://localhost:8080",
    private readonly timeoutMs = 100000000,
    private readonly authHeader?: string,
    private readonly scoutKey?: string
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    console.log("Requesting", `${this.baseUrl}${path}`);
    const useCustomTimeout =
      Number.isFinite(this.timeoutMs) && this.timeoutMs > 0;
    const controller = useCustomTimeout ? new AbortController() : undefined;
    const timeoutId = useCustomTimeout
      ? setTimeout(() => {
          controller?.abort();
        }, this.timeoutMs)
      : undefined;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
          ...(this.scoutKey ? { "X-SCOUT-KEY": this.scoutKey } : {}),
          ...(init?.headers ?? {})
        },
        signal: controller?.signal
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Indexer request failed: ${res.status} ${res.statusText} - ${text}`
        );
      }
      const responseBody = (await res.json()) as T;
      console.log("Response from indexer", responseBody);

      return responseBody;
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error(`Indexer request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.request("/api/v1/health");
      return true;
    } catch {
      return false;
    }
  }

  async fullIndex(payload: FullIndexRequest): Promise<FullIndexResponse> {
    return this.request<FullIndexResponse>("/cli/full-index", {
      method: "POST",
      body: JSON.stringify({
        repo_full_name: payload.repo_full_name,
        files: payload.files,
        ...(payload.installation_id
          ? { installation_id: payload.installation_id }
          : {})
      })
    });
  }

  async incrementalIndex(
    payload: IncrementalIndexRequest
  ): Promise<IncrementalIndexResponse> {
    return this.request<IncrementalIndexResponse>("/cli/incremental-index", {
      method: "POST",
      body: JSON.stringify({
        repo_full_name: payload.repo_full_name,
        files: payload.files ?? [],
        deleted_files: payload.deleted_files ?? [],
        ...(payload.installation_id
          ? { installation_id: payload.installation_id }
          : {})
      })
    });
  }

  async deleteRepo(repo: string): Promise<void> {
    await this.request(`/api/v1/index/${encodeURIComponent(repo)}`, {
      method: "DELETE"
    });
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    console.log("Searching code", params);
    const searchParams = new URLSearchParams();
    searchParams.set("query", params.query);

    if (params.file_types?.length) {
      for (const fileType of params.file_types) {
        if (fileType) {
          searchParams.append("file_types", fileType);
        }
      }
    }

    if (params.repos?.length) {
      for (const repo of params.repos) {
        const trimmed = typeof repo === "string" ? repo.trim() : "";
        if (trimmed) {
          searchParams.append("repo_full_name", trimmed);
        }
      }
    }

    if (typeof params.max_results === "number") {
      searchParams.set("max_results", String(params.max_results));
    }

    const path = `/search?${searchParams.toString()}`;

    const rawResponse = await this.request<unknown>(path, {
      method: "GET"
    });

    return normalizeSearchResponse(rawResponse);
  }

  async webIndex(payload: WebIndexRequest): Promise<WebIndexResponse> {
    const url = payload.url.trim();

    if (!url) {
      throw new Error("URL cannot be empty");
    }

    return this.request<WebIndexResponse>("/webIndex", {
      method: "POST",
      body: JSON.stringify({ url })
    });
  }
}
