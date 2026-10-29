import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const AI_PROVIDER = 'AI_PROVIDER';

export interface ClassificationInput {
  description: string;
  type: 'INCOME' | 'EXPENSE';
}

/**
 * Mirrors the FastAPI `ClassifyResponse`. The AI service owns the confidence
 * threshold, so `isConfident` is authoritative; the API only falls back to its
 * own threshold for older providers that do not send it.
 */
export interface RawClassification {
  label: string | null;
  confidence: number | null;
  isConfident?: boolean;
  alternatives?: Array<{ label: string; confidence: number }>;
  modelName?: string;
  modelVersion?: string;
}

export interface AiProvider {
  classify(input: ClassificationInput): Promise<RawClassification>;
  classifyBatch(inputs: ClassificationInput[]): Promise<RawClassification[]>;
  health(): Promise<boolean>;
  modelInfo(): Promise<Record<string, unknown> | null>;
}

/**
 * HTTP adapter for the Python AI service. Keeping this behind an interface
 * makes it straightforward to swap in another provider later without touching
 * business logic. Only the description and the transaction type leave the API.
 */
@Injectable()
export class HttpAiProvider implements AiProvider {
  private readonly logger = new Logger(HttpAiProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .get<string>('AI_SERVICE_URL', 'http://localhost:8000')
      .replace(/\/$/, '');
    this.timeoutMs = Number(this.configService.get<string>('AI_TIMEOUT_MS', '3000'));
  }

  async classify(input: ClassificationInput): Promise<RawClassification> {
    const response = await fetch(`${this.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: input.description, type: input.type }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`AI service responded ${response.status}`);
    }
    return (await response.json()) as RawClassification;
  }

  async classifyBatch(inputs: ClassificationInput[]): Promise<RawClassification[]> {
    const response = await fetch(`${this.baseUrl}/classify/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: inputs.map((input) => ({
          description: input.description,
          type: input.type,
        })),
      }),
      signal: AbortSignal.timeout(this.timeoutMs * 2),
    });
    if (!response.ok) {
      throw new Error(`AI service responded ${response.status}`);
    }
    const body = (await response.json()) as {
      results?: RawClassification[];
      items?: RawClassification[];
    };
    return body.results ?? body.items ?? [];
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 1500)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async modelInfo(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/model-info`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `AI service unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
