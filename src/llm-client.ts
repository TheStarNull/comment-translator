/**
 * LLM client abstraction for the semantic polishing pass.
 *
 * Supports two kinds of endpoints that speak the OpenAI Chat Completions shape:
 *   - OpenAI-compatible (OpenAI / DeepSeek / 通义 / 月之暗面 / 自建网关 ...)
 *   - Ollama local (http://localhost:11434, speaking the same /api/chat schema)
 *
 * The polishing pass calls `chatCompletion()` with a system prompt + the raw
 * machine translation, and expects a single polished string back.
 *
 * Designed to be dependency-light: uses Node's built-in `fetch` (available in
 * Node ≥ 18) under a hard deadline from ./fetch-timeout, so an unresponsive
 * gateway cannot hang the polish pass.
 */

import { fetchWithTimeout } from './fetch-timeout';

export type LlmProvider = 'openai' | 'ollama';

export interface LlmClientOptions {
  /** 'openai' (default) or 'ollama'. */
  provider?: LlmProvider;
  /** Base URL, e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1". */
  baseUrl?: string;
  /** API key. Ollama typically needs none. */
  apiKey?: string;
  /** Model name, e.g. "gpt-4o-mini", "deepseek-chat", "qwen2.5". */
  model?: string;
  /** Temperature (0 = deterministic polish). Default 0. */
  temperature?: number;
  /** Max tokens in the response. Default 1024. */
  maxTokens?: number;
  /** Request timeout in ms. Default 60000. */
  timeoutMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LlmClient {
  readonly provider: LlmProvider;
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(opts: LlmClientOptions = {}) {
    this.provider = opts.provider ?? 'openai';
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = opts.model ?? this.defaultModel();
    this.temperature = opts.temperature ?? 0;
    this.maxTokens = opts.maxTokens ?? 1024;
    this.timeoutMs = opts.timeoutMs ?? 60_000;

    if (this.provider === 'ollama') {
      // Ollama speaks OpenAI-flavoured /v1/chat/completions when the suffix is
      // present; without it we hit its native /api/chat. We normalise to the
      // OpenAI-compatible path so the request code below is shared.
      this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
    } else {
      this.baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    }
  }

  private defaultModel(): string {
    if (this.provider === 'ollama') return process.env.OLLAMA_MODEL ?? 'qwen2.5';
    return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  /**
   * Send a chat completion request and return the assistant's text.
   * Retries once on timeout / 5xx with a short backoff.
   */
  async chatCompletion(messages: ChatMessage[]): Promise<string> {
    const url = this.completionsUrl();
    const body = this.buildBody(messages);

    let lastErr: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.post(url, body);
        return this.extractText(res);
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? 0;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          // auth / bad request — no point retrying
          throw e;
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  private completionsUrl(): string {
    if (this.provider === 'ollama') {
      // Ollama native API: POST /api/chat
      return `${this.baseUrl}/api/chat`;
    }
    return `${this.baseUrl}/chat/completions`;
  }

  private buildBody(messages: ChatMessage[]): Record<string, any> {
    if (this.provider === 'ollama') {
      // Ollama's native schema uses `stream: false` and `format: "json"`.
      return {
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      };
    }
    return {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }

  private async post(url: string, body: Record<string, any>): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    // Shared deadline helper (see ./fetch-timeout), replacing the previous
    // hand-rolled AbortController.
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      this.timeoutMs,
      'LLM request'
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  private extractText(payload: any): string {
    if (this.provider === 'ollama') {
      // Ollama native: { message: { content } }  or { response }
      const content = payload?.message?.content ?? payload?.response ?? '';
      return String(content).trim();
    }
    // OpenAI: { choices: [{ message: { content } }] }
    const content = payload?.choices?.[0]?.message?.content;
    return String(content ?? '').trim();
  }
}
