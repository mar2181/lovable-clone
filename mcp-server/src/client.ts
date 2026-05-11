// HTTP Client for Worker API
import { config } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
  stream?: boolean;
  headers?: Record<string, string>;
}

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  ok: boolean;
}

class WorkerClient {
  private baseUrl: string;
  private apiKey: string;
  private userId: string;

  constructor() {
    this.baseUrl = config.workerUrl;
    this.apiKey = config.apiKey;
    this.userId = config.userId;
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      "X-User-Id": this.userId,
      ...extra,
    };
  }

  async request<T = unknown>(
    path: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { method = "GET", body, timeout = config.defaultTimeout, headers } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.getHeaders(headers),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 204 || res.headers.get("content-length") === "0") {
        return { status: res.status, data: {} as T, ok: res.ok };
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        return { status: res.status, data: data as T, ok: res.ok };
      }

      // Non-JSON response (e.g., binary export)
      const text = await res.text();
      return { status: res.status, data: text as unknown as T, ok: res.ok };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        throw new Error(`Request to ${path} timed out after ${timeout}ms`);
      }
      throw new Error(`Worker request failed: ${msg}`);
    }
  }

  /**
   * Stream SSE from the worker. Accumulates events and returns the final result.
   */
  async streamSse(
    path: string,
    body: unknown,
    timeout: number = config.requestTimeout
  ): Promise<{
    response: string;
    files: Record<string, string>;
    dependencies: Record<string, string>;
    version: number;
    chunksReceived: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Worker error ${res.status}: ${errorText}`);
      }

      if (!res.body) {
        throw new Error("No response body for SSE stream");
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";
      let files: Record<string, string> = {};
      let dependencies: Record<string, string> = {};
      let version = 0;
      let chunksReceived = 0;
      let doneReceived = false;

      // Restart timeout for stream reading
      const streamTimer = setTimeout(() => controller.abort(), timeout);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event in buffer

        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }

          if (eventType === "message" && data) {
            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "chunk") {
                fullResponse += parsed.content;
                chunksReceived++;
              } else if (parsed.type === "done") {
                doneReceived = true;
                if (parsed.files) files = parsed.files;
                if (parsed.dependencies) dependencies = parsed.dependencies;
                if (parsed.version) version = parsed.version;
              }
            } catch {
              // Skip malformed JSON
            }
          } else if (eventType === "error" && data) {
            try {
              const parsed = JSON.parse(data);
              throw new Error(parsed.error || "Unknown stream error");
            } catch (e) {
              if (e instanceof Error && e.message !== "Unexpected token") throw e;
            }
          }
        }
      }

      clearTimeout(streamTimer);

      // Fallback: if done event was missed, try parsing the accumulated response
      if (!doneReceived && fullResponse) {
        try {
          const parsed = JSON.parse(fullResponse);
          if (parsed.files) files = parsed.files;
          if (parsed.dependencies) dependencies = parsed.dependencies;
          if (parsed.version) version = parsed.version;
        } catch {
          // Response wasn't JSON — that's OK, it's the AI's text
        }
      }

      return { response: fullResponse, files, dependencies, version, chunksReceived };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        throw new Error(`SSE stream timed out after ${timeout}ms`);
      }
      throw err;
    }
  }

  /**
   * Fetch binary data (e.g., ZIP export)
   */
  async fetchBinary(path: string): Promise<{ data: ArrayBuffer; filename: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.defaultTimeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          "X-User-Id": this.userId,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Export failed ${res.status}: ${text}`);
      }

      const disposition = res.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      const filename = filenameMatch ? filenameMatch[1] : "export.zip";

      const data = await res.arrayBuffer();
      return { data, filename };
    } catch (err: unknown) {
      clearTimeout(timer);
      throw err;
    }
  }
}

export const client = new WorkerClient();
