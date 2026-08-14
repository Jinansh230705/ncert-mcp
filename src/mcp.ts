import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listBooks, listTopics, getChapterMetadata, getChapter, getCurriculumMap } from './tools/filesystem';
import { searchContent, searchChapters } from './tools/search';
import { getPrerequisites, getLearningPath } from './tools/graph';
import { generateQuestionPaper, EXAM_TEMPLATES } from './tools/question_paper';
import { getLocalDb } from './db-local';
import dotenv from 'dotenv';

dotenv.config();

const db = getLocalDb();
const env = {
    DB: db,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    MODEL_NAME: process.env.MODEL_NAME
};

const mcp = new McpServer({ 
    name: "ncert-cbse-content", 
    version: "1.0.0" 
});

// ── Discovery tools (call these first to learn what's available) ────────────

mcp.tool("list_books",
    "Return every NCERT textbook in the database. Use this FIRST to discover which grade + subject combinations exist before calling any other tool. Each result includes grade, subject, book_code, book_title, and chapters_in_database. The 'subject' values returned here (e.g. 'Mathematics', 'Science', 'English', 'Social_Science', 'Physics_1') are the EXACT strings you must use in all other tools — do not rephrase or abbreviate them. Grades range from 1 to 12.",
    {
        grade: z.number().int().min(1).max(12).optional()
            .describe("NCERT class number (1–12). Omit to return all grades."),
        subject: z.string().optional()
            .describe("Exact subject string as returned by this tool (e.g. 'Science', 'Mathematics', 'English'). Case-insensitive. Omit to return all subjects.")
    },
    async ({ grade, subject }) => ({ content: [{ type: "text", text: JSON.stringify(await listBooks(db, grade, subject), null, 2) }] })
);

mcp.tool("list_topics",
    "Return chapter numbers and titles for a specific textbook. Requires exact grade and subject. Call list_books first if unsure which subjects exist for a grade. Returns an array of objects with chapter number, chapter_title, and book_title.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books (e.g. 'Science', 'Mathematics_1'). Case-insensitive.")
    },
    async ({ grade, subject }) => ({ content: [{ type: "text", text: JSON.stringify(await listTopics(db, grade, subject), null, 2) }] })
);

mcp.tool("list_exam_types",
    "Return all supported exam paper formats with their total marks, duration, and section breakdown (question types, count per section, marks per question). Call this before generate_question_paper to show the user available options. No parameters required.",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(EXAM_TEMPLATES, null, 2) }] })
);

// ── Textbook content tools ──────────────────────────────────────────────────

mcp.tool("get_chapter",
    "Return the full extracted plain-text of a single NCERT chapter, reconstructed from database chunks. Use list_topics first to find valid chapter numbers for a given grade + subject. The response includes the full text, grade, subject, chapter number, and source type.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books."),
        chapter: z.number().int().min(1)
            .describe("Chapter number. Use list_topics to find valid chapter numbers.")
    },
    async ({ grade, subject, chapter }) => ({ content: [{ type: "text", text: JSON.stringify(await getChapter(db, grade, subject, chapter), null, 2) }] })
);

mcp.tool("get_chapter_metadata",
    "Return source metadata for a specific chapter: the NCERT download URL, book_code, and local filename. This is a fast lookup with no content parsing. Useful for citations and source attribution.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books."),
        chapter: z.number().int().min(1)
            .describe("Chapter number. Use list_topics to find valid chapter numbers.")
    },
    async ({ grade, subject, chapter }) => ({ content: [{ type: "text", text: JSON.stringify(await getChapterMetadata(db, grade, subject, chapter), null, 2) }] })
);

mcp.tool("get_curriculum_map",
    "Return the full curriculum map for a textbook: every chapter's topics with their Bloom's taxonomy levels, difficulty ratings, and chunk counts. Useful for understanding available content before generating questions or papers. Requires exact grade and subject — call list_books first if unsure.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books.")
    },
    async ({ grade, subject }) => ({ content: [{ type: "text", text: JSON.stringify(await getCurriculumMap(db, grade, subject), null, 2) }] })
);

// ── Search tools ────────────────────────────────────────────────────────────

mcp.tool("search_chapters",
    "Full-text keyword search (SQLite FTS5) across all NCERT chapter content. Returns matching chapters ranked by BM25 relevance with a 300-character text snippet. IMPORTANT: grade and subject are strict SQL filters — if provided incorrectly, results will be empty. Omit them to search across ALL grades and subjects, then narrow down after seeing results.",
    {
        query: z.string()
            .describe("Search keywords. Use natural terms like 'photosynthesis' or 'quadratic equations'. Multiple words are ANDed together."),
        grade: z.number().int().min(1).max(12).optional()
            .describe("Strict filter. Only include if you are CERTAIN of the grade. Omit to search all grades."),
        subject: z.string().optional()
            .describe("Strict filter. Must be an exact subject string from list_books. Omit to search all subjects."),
        top_k: z.number().int().min(1).max(50).default(5)
            .describe("Maximum number of chapter results to return. Default: 5.")
    },
    async ({ query, grade, subject, top_k }) => ({ content: [{ type: "text", text: JSON.stringify(await searchChapters(db, query, grade, subject, top_k), null, 2) }] })
);

mcp.tool("search_content",
    "Full-text search (SQLite FTS5) over fine-grained NCERT content chunks. Each result includes the matching text, topic label, Bloom's taxonomy level, difficulty rating, and pre-filled parameters you can pass directly to generate_explanation, generate_question, or get_learning_path. IMPORTANT: grade, subject, and bloom_level are all strict SQL filters — if any value is wrong, you will get zero results. Omit optional filters when uncertain.",
    {
        query: z.string()
            .describe("Search keywords. Use specific NCERT terms. Multiple words are ANDed together."),
        grade: z.number().int().min(1).max(12).optional()
            .describe("Strict filter. Only include if you are CERTAIN of the grade. Omit to search all grades."),
        subject: z.string().optional()
            .describe("Strict filter. Must be an exact subject string from list_books. Omit to search all subjects."),
        bloom_level: z.enum(["remember", "understand", "apply", "analyse", "evaluate", "create"]).optional()
            .describe("Strict filter by Bloom's taxonomy level. Omit to include all levels."),
        top_k: z.number().int().min(1).max(50).default(8)
            .describe("Maximum number of chunk results to return. Default: 8.")
    },
    async ({ query, grade, subject, bloom_level, top_k }) => ({ content: [{ type: "text", text: JSON.stringify(await searchContent(db, query, grade, subject, bloom_level, top_k), null, 2) }] })
);

// ── RAG generation tools ────────────────────────────────────────────────────

mcp.tool("generate_explanation",
    "Generate an NCERT-grounded explanation for a topic using retrieval-augmented generation. Internally searches the database for relevant chunks, then produces a structured Markdown explanation with sections: Definition, Key Concepts, Examples, Summary, and optional Mermaid diagrams. The tone adapts to the grade level (simple for grades 1–5, formal for 9–10, analytical for 11–12). Returns the explanation text plus metadata about source chunks and model used.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number. Determines tone and complexity of the explanation."),
        subject: z.string()
            .describe("Exact subject string from list_books."),
        topic: z.string()
            .describe("The topic to explain. Use specific NCERT topic names (e.g. 'Photosynthesis', 'Linear Equations in One Variable'). Use search_content or get_curriculum_map to find exact topic names."),
        language: z.enum(["en", "hi"]).default("en")
            .describe("Output language. 'en' for English, 'hi' for Hindi. Default: 'en'.")
    },
    async ({ grade, subject, topic, language }) => {
        const { streamExplanation } = await import('./tools/generation');
        let fullText = "";
        let metadata: any = null;
        for await (const [text, meta] of streamExplanation(env, grade, subject, topic, language)) {
            if (meta === null) {
                fullText += text;
            } else {
                metadata = meta;
            }
        }
        return { content: [{ type: "text", text: fullText }, { type: "text", text: JSON.stringify(metadata, null, 2) }] };
    }
);

mcp.tool("generate_question",
    "Generate a single CBSE-pattern question grounded in NCERT content. Internally retrieves relevant textbook chunks, then uses an LLM to produce a question with answer, marking scheme, and distractors (for MCQs). Returns structured JSON with question, answer, marking_scheme array, and distractors array.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books."),
        topic: z.string()
            .describe("Specific topic name. Use search_content or get_curriculum_map to find exact topic names available in the database."),
        bloom_level: z.enum(["remember", "understand", "apply", "analyse", "evaluate", "create"]).default("understand")
            .describe("Bloom's taxonomy level for the question. Default: 'understand'."),
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium")
            .describe("Difficulty level. Default: 'medium'."),
        question_type: z.enum(["MCQ", "SAQ", "LAQ"]).default("MCQ")
            .describe("Question format. MCQ = Multiple Choice (1 mark), SAQ = Short Answer (2–3 marks), LAQ = Long Answer (5–6 marks). Default: 'MCQ'."),
        marks: z.number().int().min(1).max(6).default(1)
            .describe("Mark weightage for the question. Typical: MCQ=1, SAQ=2–3, LAQ=5–6. Default: 1.")
    },
    async ({ grade, subject, topic, bloom_level, difficulty, question_type, marks }) => {
        const { streamQuestion } = await import('./tools/generation');
        let fullText = "";
        let metadata: any = null;
        for await (const [text, meta] of streamQuestion(env, grade, subject, topic, bloom_level, difficulty, question_type, marks)) {
            if (meta === null) {
                fullText += text;
            } else {
                metadata = meta;
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(metadata || fullText, null, 2) }] };
    }
);

mcp.tool("generate_question_paper",
    "Generate a complete CBSE-pattern question paper with multiple sections. Call list_exam_types first to see available exam formats and their structure (marks, duration, sections). Each section contains questions generated from NCERT content. Optionally restrict to specific chapters. Returns the full paper with title, duration, total marks, instructions, sections with questions, and optional answer key.",
    {
        grade: z.number().int().min(1).max(12)
            .describe("NCERT class number (1–12)."),
        subject: z.string()
            .describe("Exact subject string from list_books."),
        exam_type: z.enum(["class_test", "weekly_test", "monthly_test", "mid_term", "pre_board", "board"])
            .describe("Exam format key. Call list_exam_types to see marks, duration, and section structure for each type."),
        chapters: z.array(z.number().int().min(1)).optional()
            .describe("Restrict questions to specific chapter numbers. Use list_topics to find valid chapter numbers. Omit to use all chapters."),
        include_answer_key: z.boolean().default(true)
            .describe("Whether to include answers and marking schemes in the output. Default: true.")
    },
    async ({ grade, subject, exam_type, chapters, include_answer_key }) => ({ content: [{ type: "text", text: JSON.stringify(await generateQuestionPaper(env, grade, subject, exam_type, chapters, undefined, include_answer_key), null, 2) }] })
);

// ── Curriculum graph tools ──────────────────────────────────────────────────

mcp.tool("get_prerequisites",
    "Return the immediate prerequisite topics for a given topic from the curriculum dependency graph. Each prerequisite includes the source grade, subject, chapter, topic name, rationale, and confidence score. The topic string must match a topic label in the database — use search_content or get_curriculum_map to find exact topic names.",
    {
        topic: z.string()
            .describe("Exact topic name as stored in the database. Use search_content or get_curriculum_map to find valid topic names."),
        grade: z.number().int().min(1).max(12)
            .describe("Grade of the target topic."),
        subject: z.string()
            .describe("Exact subject string from list_books.")
    },
    async ({ topic, grade, subject }) => ({ content: [{ type: "text", text: JSON.stringify(await getPrerequisites(db, topic, grade, subject), null, 2) }] })
);

mcp.tool("get_learning_path",
    "Return the full ordered learning path for a topic by traversing the curriculum dependency graph backwards through all prerequisites (up to 6 levels deep). The path is returned roots-first: start studying from step 1, end at the target topic. Each step includes topic name, grade, subject, and depth level. Use search_content or get_curriculum_map to find exact topic names.",
    {
        topic: z.string()
            .describe("Exact topic name as stored in the database. Use search_content or get_curriculum_map to find valid topic names."),
        grade: z.number().int().min(1).max(12)
            .describe("Grade of the target topic."),
        subject: z.string()
            .describe("Exact subject string from list_books.")
    },
    async ({ topic, grade, subject }) => ({ content: [{ type: "text", text: JSON.stringify(await getLearningPath(db, topic, grade, subject), null, 2) }] })
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
}

main().catch(console.error);
