import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import MiniSearch from 'minisearch';
import type { D1Database } from '@cloudflare/workers-types';

class LocalD1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    return {
      bind: (...params: any[]) => {
        const safeParams = params.map(p => p === undefined ? null : p);
        return {
          all: async () => {
            try {
              const results = stmt.all(...safeParams);
              return { results };
            } catch (e: any) {
              console.error(`Local DB all() error for [${sql}]:`, e);
              throw e;
            }
          },
          first: async () => {
            try {
              const row = stmt.get(...safeParams);
              return row;
            } catch (e: any) {
              console.error(`Local DB first() error for [${sql}]:`, e);
              throw e;
            }
          },
          run: async () => {
            try {
              const info = stmt.run(...safeParams);
              return {
                meta: {
                  last_row_id: info.lastInsertRowid,
                  changes: info.changes
                }
              };
            } catch (e: any) {
              console.error(`Local DB run() error for [${sql}]:`, e);
              throw e;
            }
          }
        };
      }
    };
  }
}

export function getLocalDb(): D1Database {
  const dbPath = path.join(process.cwd(), 'data', 'content.db');
  return new LocalD1Database(dbPath) as unknown as D1Database;
}

export function initDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'data', 'content.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return new Database(dbPath);
}

const SEARCH_INDEX_PATH = path.join(process.cwd(), 'data', 'search_index.json');

const searchIndexOptions = {
  fields: ['text', 'topic'],
  storeFields: ['source_file', 'grade', 'subject', 'chapter', 'chunk_index', 'bloom_level', 'topic', 'difficulty', 'text']
};

export function getSearchIndex(): MiniSearch {
  if (fs.existsSync(SEARCH_INDEX_PATH)) {
    try {
      const data = fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8');
      return MiniSearch.loadJSON(data, searchIndexOptions);
    } catch (e) {
      console.warn("Failed to load search index, returning empty:", e);
    }
  }
  return new MiniSearch(searchIndexOptions);
}

export function saveSearchIndex(index: MiniSearch): void {
  const dir = path.dirname(SEARCH_INDEX_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(index.toJSON()), 'utf-8');
}
