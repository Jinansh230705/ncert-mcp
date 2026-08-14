# NCERT MCP

> **Note:** This project is a TypeScript/Bun port inspired by the original work from [hatchedland/ncert-mcp](https://github.com/hatchedland/ncert-mcp).
An open-source **Model Context Protocol (MCP) server** and **REST API** that turns the entire NCERT/CBSE curriculum (Grades 1–12) into structured, queryable infrastructure.

Built for ed-tech companies that want to build on top of NCERT content — explanations, question generation, semantic search, and topic mapping — without rebuilding the data pipeline themselves. 


---

## What it does

| Capability | Description |
|-----------|-------------|
| **Semantic search** | Vectorless search over NCERT chunks via Minisearch — each result includes topic highlight, Bloom's level, and pre-filled actions (explain, question, learning path) |
| **Keyword search** | BM25 search across all chapter PDFs |
| **RAG explanations** | Grade-aware explanations with Markdown structure, LaTeX formulas, Mermaid diagrams, and callout notes |
| **Question generation** | Structured MCQ / SAQ / LAQ with marking schemes, Bloom's tagging |
| **Question papers** | Full CBSE-pattern papers: class test → pre-board → board exam |
| **Curriculum graph** | Prerequisite edges across subjects — powers learning paths |
| **Question bank** | Persistent SQLite store; questions reused across papers, never re-generated |
| **REST API / OpenAPI** | All tools exposed as HTTP endpoints for ChatGPT Custom Actions & non-MCP clients |
| **Remote MCP** | Dedicated Express SSE server for Claude.ai remote connectors |

---

## Architecture

- **Runtime:** Bun + TypeScript
- **Web Framework:** Hono + Zod (for OpenAPI spec generation)
- **Database:** Better-SQLite3 (Metadata) + Minisearch (Vectorless Search Index)
- **AI/LLM Client:** Universal `openai` SDK pointing to OpenRouter (Use Claude, Gemini, DeepSeek, etc)
- **Deployment:** Cloudflare Workers (Serverless REST API and SSE) + Cloudflare D1 (Database)

---

## MCP Tools (13 tools)

### Textbook tools

| Tool | Description |
|------|-------------|
| `list_books` | List available NCERT textbooks, filter by grade/subject |
| `list_topics` | Chapter titles for a textbook |
| `get_chapter` | Full extracted text of one chapter |
| `get_chapter_metadata` | Source URL, download date (fast, no PDF parse) |
| `search_chapters` | BM25 keyword search across all PDFs |

### Search tools

| Tool | Description |
|------|-------------|
| `search_content` | Semantic search with grade/subject/Bloom's filters. Returns scored results with pre-filled action params |
| `get_curriculum_map` | Topics + Bloom's level distribution per chapter |

### RAG + Generation tools

| Tool | Description |
|------|-------------|
| `generate_explanation` | RAG-grounded explanation — Markdown, LaTeX, Mermaid diagrams |
| `generate_question` | Single structured question (MCQ/SAQ/LAQ) with marking scheme |
| `generate_question_paper` | Full CBSE-pattern paper (class test → board exam) |
| `list_exam_types` | List supported exam types with marks, duration, sections |

### Curriculum Graph tools

| Tool | Description |
|------|-------------|
| `get_prerequisites` | Direct prerequisite topics for a given topic |
| `get_learning_path` | Full ordered prerequisite chain, roots first |

---

## REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/openapi.json` | OpenAPI 3.1 spec (plug into ChatGPT / Swagger) |
| GET | `/health` | Health check |
| GET | `/books` | List textbooks |
| GET | `/books/{grade}/{subject}/topics` | Chapter list |
| GET | `/books/{grade}/{subject}/chapters/{n}` | Full chapter text |
| GET | `/books/{grade}/{subject}/chapters/{n}/metadata` | Chapter metadata |
| GET | `/search/content` | Semantic search — returns `highlight`, `actions`, `topic`, `bloom_level` per result |
| GET | `/search/chapters` | BM25 keyword search |
| GET | `/curriculum/{grade}/{subject}` | Curriculum map (topics + Bloom's per chapter) |
| POST | `/explain` | Stream explanation (SSE) — Markdown, LaTeX, Mermaid diagram |
| POST | `/question` | Stream question generation (SSE) |
| GET | `/exam-types` | List supported exam types |
| POST | `/question-paper` | Generate full question paper |
| GET | `/graph/prerequisites` | Prerequisite topics |
| GET | `/graph/learning-path` | Full learning path |


## Quick start

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- An [OpenRouter](https://openrouter.ai/) API key (or any OpenAI-compatible key)

### 1. Clone and set up

```bash
git clone https://github.com/Jinansh230705/ncert-mcp
cd ncert-mcp
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — add OPENAI_API_KEY, optionally OPENAI_BASE_URL and MODEL_NAME
```

### 3. Ingest data (run once locally)

Downloads all K-12 NCERT PDFs, chunks them, tags each chunk with Bloom's level/topic/difficulty via OpenRouter, and writes the SQLite + Minisearch index:

```bash
bun run ingest
```

> This is a one-time local step. Re-run to pick up newly added textbooks. Already-processed chapters are skipped automatically.

### 4. Run locally

```bash
# REST API + OpenAPI (http://localhost:8000)
bun run dev

# MCP stdio server (for Claude Desktop)
bun run dev:mcp

# MCP SSE server (for Claude Remote Connectors)
bun run dev:remote
```

---

## Usage & Integrations

### 1. Hosted MCP (Claude.ai)

You can connect directly to the hosted MCP server without running it locally. 

**Connection Guide for Claude.ai:**
1. Go to Claude.ai and add a new Remote MCP Server.
2. **URL:** `https://ncert.getmaterio.app/mcp`
3. **Authentication:** None (No Auth)

### 2. ChatGPT Custom GPT

Try it out on ChatGPT using the GPT Store:
**[NCERT GPT in ChatGPT's GPT Store](https://chatgpt.com/g/g-6a57962baecc8191a03ec83955651bf9-ncert)**

Alternatively, create your own Custom GPT and paste the OpenAPI spec: `https://ncert.getmaterio.app/openapi.json`

### 3. Local MCP — Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ncert-mcp": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/ncert-mcp/src/mcp.ts"]
    }
  }
}
```

### 4. Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector bun run src/mcp.ts
```

### 5. Cloudflare Deployment

Deploy the repository to Cloudflare Workers using Wrangler:

```bash
bun run deploy
```

> **Note:** Ensure you have provisioned a Cloudflare D1 database and updated your `wrangler.toml` accordingly. The database schema is automatically applied using the provided migrations or the ingestion script.

---

## Contributing

Pull requests welcome!

1. Add textbook mappings to `NCERT_TEXTBOOK_CHAPTERS` in `src/pipeline.ts`
2. Run `bun run ingest` to download and index new PDFs
3. Add new MCP tools to `src/mcp.ts` and `src/mcp-express.ts`
4. Add corresponding REST routes to `src/index.ts`

