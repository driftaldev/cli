import type { SearchResponse } from "../indexer/client.js";

export function buildContext(response: SearchResponse) {
  return response.results.map((result) => ({
    repo: result.repo ?? response.repo ?? result.filename ?? "",
    filePath:
      result.file_path ??
      result.path ??
      result.location ??
      result.filename ??
      "",
    snippet:
      result.snippet ?? result.content ?? result.text ?? result.summary ?? "",
    score: result.score ?? result.similarity ?? 0,
    range:
      result.line_start != null && result.line_end != null
        ? { start: result.line_start, end: result.line_end }
        : result.start_line != null && result.end_line != null
        ? { start: result.start_line, end: result.end_line }
        : undefined
  }));
}
