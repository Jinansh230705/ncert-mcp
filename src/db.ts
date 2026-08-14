import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  MODEL_NAME?: string;
}

export function sanitizeFtsQuery(query: string): string {
    const words = query
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length > 0);
    
    if (words.length === 0) return '';
    return words.map(w => `${w}*`).join(' AND ');
}
