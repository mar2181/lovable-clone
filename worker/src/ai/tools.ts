import { tool, jsonSchema } from "ai";
import type { Bindings } from "../index";

const TAVILY_BASE = "https://api.tavily.com";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

const SEARCH_RESULT_BUDGET = 2 * 1024;
const SEARCH_SNIPPET_CAP = 500;
const FETCH_CONTENT_CAP = 50 * 1024;
const SCRAPE_CONTENT_CAP = 80 * 1024;
const QUERY_LENGTH_CAP = 400;

type WebSearchInput = { query: string; max_results?: number };
type WebFetchInput = { url: string };
type WebScrapeInput = { url: string; only_main_content?: boolean };

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: { title?: string; statusCode?: number } & Record<string, unknown>;
  };
  error?: string;
};

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilySearchResponse = {
  results?: TavilySearchResult[];
};

type TavilyExtractResult = {
  url?: string;
  raw_content?: string;
};

type TavilyExtractResponse = {
  results?: TavilyExtractResult[];
};

function clampString(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function packResultsToBudget(
  results: Array<{ title: string; url: string; snippet: string }>,
  budget: number,
): Array<{ title: string; url: string; snippet: string }> {
  const out: typeof results = [];
  let used = 0;
  for (const r of results) {
    const size = r.title.length + r.url.length + r.snippet.length + 16;
    if (used + size > budget && out.length > 0) break;
    out.push(r);
    used += size;
  }
  return out;
}

export function buildTools(env: Bindings) {
  const apiKey = env.TAVILY_API_KEY || "";
  const firecrawlKey = env.FIRECRAWL_API_KEY || "";

  const web_search = tool({
    description:
      "Search the public web for up-to-date information you don't already know from the project files. Use this for current prices, competitor sites, library docs, recent news, or anything that could have changed since your training. Returns a short list of {title, url, snippet}; cite the URL in your reply.",
    inputSchema: jsonSchema<WebSearchInput>({
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query, plain English, max 400 characters.",
          maxLength: QUERY_LENGTH_CAP,
        },
        max_results: {
          type: "integer",
          description: "How many results to return (1-5). Default 3.",
          minimum: 1,
          maximum: 5,
        },
      },
      required: ["query"],
    }),
    execute: async ({ query, max_results }) => {
      if (!apiKey) {
        return { error: "web_search is unavailable: TAVILY_API_KEY is not configured on the worker." };
      }
      const q = (query || "").trim();
      if (!q) return { error: "Empty query." };
      if (q.length > QUERY_LENGTH_CAP) {
        return { error: `Query too long (${q.length} > ${QUERY_LENGTH_CAP}).` };
      }
      const count = Math.min(Math.max(max_results ?? 3, 1), 5);

      try {
        const resp = await fetch(`${TAVILY_BASE}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: q,
            search_depth: "basic",
            max_results: count,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return {
            error: `Tavily search failed: ${resp.status} ${resp.statusText} ${clampString(text, 200)}`,
          };
        }

        const data = (await resp.json()) as TavilySearchResponse;
        const raw = Array.isArray(data.results) ? data.results : [];
        const shaped = raw
          .filter((r) => r.url && (r.title || r.content))
          .map((r) => ({
            title: clampString(r.title || r.url || "", 160),
            url: r.url || "",
            snippet: clampString((r.content || "").replace(/\s+/g, " ").trim(), SEARCH_SNIPPET_CAP),
          }));

        const packed = packResultsToBudget(shaped, SEARCH_RESULT_BUDGET);
        return { query: q, results: packed };
      } catch (err: any) {
        return { error: `web_search threw: ${err?.message || String(err)}` };
      }
    },
  });

  const web_fetch = tool({
    description:
      "Fetch a single web page by URL and return its readable text content (no nav, ads, or markup). Use this after web_search when a snippet isn't enough, or when the user gives you a URL directly. Content is truncated to ~50 KB.",
    inputSchema: jsonSchema<WebFetchInput>({
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL of the page to fetch.",
          format: "uri",
        },
      },
      required: ["url"],
    }),
    execute: async ({ url }) => {
      if (!apiKey) {
        return { error: "web_fetch is unavailable: TAVILY_API_KEY is not configured on the worker." };
      }
      const u = (url || "").trim();
      if (!/^https?:\/\//i.test(u)) {
        return { error: "URL must start with http:// or https://" };
      }

      try {
        const resp = await fetch(`${TAVILY_BASE}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, urls: [u] }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return {
            error: `Tavily extract failed: ${resp.status} ${resp.statusText} ${clampString(text, 200)}`,
          };
        }

        const data = (await resp.json()) as TavilyExtractResponse;
        const first = Array.isArray(data.results) ? data.results[0] : undefined;
        const content = (first?.raw_content || "").trim();
        if (!content) {
          return { error: `No content extracted from ${u}.` };
        }
        return { url: first?.url || u, content: clampString(content, FETCH_CONTENT_CAP) };
      } catch (err: any) {
        return { error: `web_fetch threw: ${err?.message || String(err)}` };
      }
    },
  });

  const web_scrape = tool({
    description:
      "Scrape a full web page with JS rendering and return clean markdown. Use this when web_fetch isn't enough — SPAs, long pages, sites that block simple fetchers, or when you need the full structured copy of a page to clone or quote. Slower and more expensive than web_fetch; do not call for pages that web_search snippets already cover. Returns markdown (capped at ~80 KB).",
    inputSchema: jsonSchema<WebScrapeInput>({
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL of the page to scrape.",
          format: "uri",
        },
        only_main_content: {
          type: "boolean",
          description: "Strip nav/footer/ads and return only the main content. Default true.",
        },
      },
      required: ["url"],
    }),
    execute: async ({ url, only_main_content }) => {
      if (!firecrawlKey) {
        return { error: "web_scrape is unavailable: FIRECRAWL_API_KEY is not configured on the worker." };
      }
      const u = (url || "").trim();
      if (!/^https?:\/\//i.test(u)) {
        return { error: "URL must start with http:// or https://" };
      }

      try {
        const resp = await fetch(FIRECRAWL_SCRAPE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: u,
            formats: ["markdown"],
            onlyMainContent: only_main_content !== false,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return {
            error: `Firecrawl scrape failed: ${resp.status} ${resp.statusText} ${clampString(text, 200)}`,
          };
        }

        const data = (await resp.json()) as FirecrawlScrapeResponse;
        const markdown = (data.data?.markdown || "").trim();
        if (!markdown) {
          return { error: `No content scraped from ${u}.` };
        }
        return {
          url: u,
          title: data.data?.metadata?.title,
          markdown: clampString(markdown, SCRAPE_CONTENT_CAP),
        };
      } catch (err: any) {
        return { error: `web_scrape threw: ${err?.message || String(err)}` };
      }
    },
  });

  return { web_search, web_fetch, web_scrape };
}
