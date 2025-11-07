import * as cheerio from "cheerio";
import { fetch } from "undici";

export interface CrawledDocument {
  title?: string;
  url: string;
  content: string;
}

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  followLinks?: boolean;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  timeout?: number;
}

export class DocumentCrawler {
  private visited = new Set<string>();
  private queue: Array<{ url: string; depth: number }> = [];

  constructor(private options: CrawlOptions = {}) {
    this.options = {
      maxDepth: 1,
      maxPages: 10,
      followLinks: false,
      timeout: 30000,
      ...options
    };
  }

  async crawl(startUrl: string): Promise<CrawledDocument[]> {
    this.visited.clear();
    this.queue = [{ url: startUrl, depth: 0 }];

    const documents: CrawledDocument[] = [];

    while (this.queue.length > 0 && documents.length < (this.options.maxPages || 10)) {
      const { url, depth } = this.queue.shift()!;

      if (this.visited.has(url) || depth > (this.options.maxDepth || 1)) {
        continue;
      }

      // Check include/exclude patterns
      if (this.options.excludePatterns?.some(pattern => pattern.test(url))) {
        continue;
      }

      if (
        this.options.includePatterns &&
        this.options.includePatterns.length > 0 &&
        !this.options.includePatterns.some(pattern => pattern.test(url))
      ) {
        continue;
      }

      this.visited.add(url);

      try {
        const doc = await this.fetchAndParse(url);
        documents.push(doc);

        // Extract links if we should follow them
        if (this.options.followLinks && depth < (this.options.maxDepth || 1)) {
          const links = await this.extractLinks(url, doc.content);
          for (const link of links) {
            if (!this.visited.has(link)) {
              this.queue.push({ url: link, depth: depth + 1 });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to crawl ${url}:`, error);
      }
    }

    return documents;
  }

  async crawlSingle(url: string): Promise<CrawledDocument> {
    return this.fetchAndParse(url);
  }

  private async fetchAndParse(url: string): Promise<CrawledDocument> {
    console.log(`Fetching ${url}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout || 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ScoutCode DocumentCrawler/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove script, style, and other non-content elements
      $("script, style, nav, footer, header, aside, iframe, noscript").remove();

      // Extract title
      const title = $("title").text().trim() || $("h1").first().text().trim() || url;

      // Extract main content
      // Try to find main content area
      const mainSelectors = [
        "main",
        "article",
        '[role="main"]',
        ".content",
        ".main-content",
        "#content",
        "#main-content",
        ".documentation",
        ".docs-content"
      ];

      let contentElement = null;
      for (const selector of mainSelectors) {
        const found = $(selector).first();
        if (found.length > 0) {
          contentElement = found;
          break;
        }
      }

      // Fallback to body if no main content area found
      if (!contentElement) {
        contentElement = $("body");
      }

      // Extract text while preserving some structure
      const content = this.extractTextContent(contentElement, $);

      // Clean up whitespace
      const cleanedContent = content
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join("\n");

      return {
        title,
        url,
        content: cleanedContent
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractTextContent(element: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string {
    const textParts: string[] = [];

    element.contents().each((_index, node) => {
      if (node.type === "text") {
        const text = $(node).text().trim();
        if (text) {
          textParts.push(text);
        }
      } else if (node.type === "tag") {
        const tagName = (node as any).name;

        // Add newlines for block elements
        const blockElements = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote"];
        const isBlock = blockElements.includes(tagName);

        if (isBlock) {
          const childText = this.extractTextContent($(node), $);
          if (childText) {
            textParts.push(childText);
            textParts.push(""); // Add newline
          }
        } else {
          const childText = this.extractTextContent($(node), $);
          if (childText) {
            textParts.push(childText);
          }
        }
      }
    });

    return textParts.join(" ");
  }

  private async extractLinks(baseUrl: string, html: string): Promise<string[]> {
    const $ = cheerio.load(html);
    const links: string[] = [];
    const base = new URL(baseUrl);

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;

      try {
        // Resolve relative URLs
        const absoluteUrl = new URL(href, baseUrl);

        // Only follow same-domain links
        if (absoluteUrl.hostname === base.hostname) {
          // Remove hash fragments
          absoluteUrl.hash = "";
          const cleanUrl = absoluteUrl.toString();

          if (!links.includes(cleanUrl)) {
            links.push(cleanUrl);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    });

    return links;
  }
}

/**
 * Helper function to crawl a single URL
 */
export async function crawlUrl(url: string, options?: CrawlOptions): Promise<CrawledDocument[]> {
  const crawler = new DocumentCrawler(options);
  return crawler.crawl(url);
}

/**
 * Helper function to fetch a single page
 */
export async function fetchSinglePage(url: string): Promise<CrawledDocument> {
  const crawler = new DocumentCrawler();
  return crawler.crawlSingle(url);
}
