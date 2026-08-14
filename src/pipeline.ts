import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';
import { initDb, getSearchIndex, saveSearchIndex } from './db-local';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const DATA_DIR = path.join(process.cwd(), 'data');
const PDF_DIR = path.join(DATA_DIR, 'raw', 'ncert_pdfs');
const CACHE_DIR = path.join(DATA_DIR, 'processed', 'text_cache');

const ai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY || "dummy",
});
const MODEL = process.env.MODEL_NAME || 'google/gemini-2.5-pro';

const fallbackAi = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.FALLBACK_API_KEY || "",
});
const FALLBACK_MODEL = "models/gemma-4-31b-it";

const NCERT_TEXTBOOK_CHAPTERS: Record<string, { grade: number, subject: string, numChapters: number }> = {
    // Grade 1
    "aejm1": { grade: 1, subject: "Mathematics", numChapters: 13 },
    "aemr1": { grade: 1, subject: "English", numChapters: 9 },
    "ahsr1": { grade: 1, subject: "Hindi", numChapters: 19 },
    // Grade 2
    "bejm1": { grade: 2, subject: "Mathematics", numChapters: 11 },
    "bemr1": { grade: 2, subject: "English", numChapters: 13 },
    "bhsr1": { grade: 2, subject: "Hindi", numChapters: 26 },
    // Grade 3
    "cemm1": { grade: 3, subject: "Mathematics", numChapters: 14 },
    "cesa1": { grade: 3, subject: "English", numChapters: 12 },
    "ceev1": { grade: 3, subject: "EVS", numChapters: 12 },
    "chve1": { grade: 3, subject: "Hindi", numChapters: 18 },
    // Grade 4
    "demm1": { grade: 4, subject: "Mathematics", numChapters: 14 },
    "desa1": { grade: 4, subject: "English", numChapters: 12 },
    "deev1": { grade: 4, subject: "EVS", numChapters: 10 },
    "dhve1": { grade: 4, subject: "Hindi", numChapters: 13 },
    // Grade 5
    "eemm1": { grade: 5, subject: "Mathematics", numChapters: 15 },
    "eesa1": { grade: 5, subject: "English", numChapters: 10 },
    "eeev1": { grade: 5, subject: "EVS", numChapters: 10 },
    "ehve1": { grade: 5, subject: "Hindi", numChapters: 12 },
    // Grade 6
    "fegp1": { grade: 6, subject: "Mathematics", numChapters: 10 },
    "fecu1": { grade: 6, subject: "Science", numChapters: 12 },
    "fees1": { grade: 6, subject: "Social_Science", numChapters: 14 },
    "fepr1": { grade: 6, subject: "English", numChapters: 5 },
    "fhml1": { grade: 6, subject: "Hindi", numChapters: 13 },
    "fsde1": { grade: 6, subject: "Sanskrit", numChapters: 16 },
    // Grade 7
    "gegp1": { grade: 7, subject: "Mathematics_1", numChapters: 8 },
    "gegp2": { grade: 7, subject: "Mathematics_2", numChapters: 7 },
    "gecu1": { grade: 7, subject: "Science", numChapters: 12 },
    "gees1": { grade: 7, subject: "Social_Science_1", numChapters: 12 },
    "gees2": { grade: 7, subject: "Social_Science_2", numChapters: 8 },
    "gepr1": { grade: 7, subject: "English", numChapters: 5 },
    "ghml1": { grade: 7, subject: "Hindi", numChapters: 10 },
    "gsde1": { grade: 7, subject: "Sanskrit", numChapters: 15 },
    // Grade 8
    "hegp1": { grade: 8, subject: "Mathematics_1", numChapters: 7 },
    "hegp2": { grade: 8, subject: "Mathematics_2", numChapters: 7 },
    "hecu1": { grade: 8, subject: "Science", numChapters: 13 },
    "hees1": { grade: 8, subject: "Social_Science", numChapters: 7 },
    "hepr1": { grade: 8, subject: "English", numChapters: 5 },
    "hhml1": { grade: 8, subject: "Hindi", numChapters: 10 },
    "hsde1": { grade: 8, subject: "Sanskrit", numChapters: 16 },
    // Grade 9
    "iemh1": { grade: 9, subject: "Mathematics", numChapters: 8 }, // Ganita Manjari
    "iesc1": { grade: 9, subject: "Science", numChapters: 13 }, // Exploration
    "iest1": { grade: 9, subject: "Social_Science", numChapters: 9 }, // Understanding Society India and Beyond PART-I
    "iebe1": { grade: 9, subject: "English", numChapters: 8 }, // Kaveri
    "ihga1": { grade: 9, subject: "Hindi", numChapters: 12 }, // Ganga
    "ihsh1": { grade: 9, subject: "Sanskrit", numChapters: 16 }, // Sharada
    // Grade 10
    "jemh1": { grade: 10, subject: "Mathematics", numChapters: 14 },
    "jesc1": { grade: 10, subject: "Science", numChapters: 13 },
    "jeff1": { grade: 10, subject: "English", numChapters: 9 },
    "jefp1": { grade: 10, subject: "English_Supplementary", numChapters: 9 },
    "jhks1": { grade: 10, subject: "Hindi_1", numChapters: 12 },
    "jhsp1": { grade: 10, subject: "Hindi_2", numChapters: 14 },
    "jhsk1": { grade: 10, subject: "Sanskrit_1", numChapters: 10 },
    "jsab1": { grade: 10, subject: "Sanskrit_2", numChapters: 14 },
    // Grade 11
    "kemh1": { grade: 11, subject: "Mathematics", numChapters: 14 },
    "keph1": { grade: 11, subject: "Physics_1", numChapters: 7 },
    "keph2": { grade: 11, subject: "Physics_2", numChapters: 7 },
    "kech1": { grade: 11, subject: "Chemistry_1", numChapters: 6 },
    "kech2": { grade: 11, subject: "Chemistry_2", numChapters: 3 },
    "kebo1": { grade: 11, subject: "Biology", numChapters: 19 },
    "kehs1": { grade: 11, subject: "History", numChapters: 7 },
    "kegy1": { grade: 11, subject: "Geography_1", numChapters: 6 },
    "kecs1": { grade: 11, subject: "Computer_Science", numChapters: 11 },
    "khat1": { grade: 11, subject: "Hindi_1", numChapters: 16 },
    "khar1": { grade: 11, subject: "Hindi_2", numChapters: 16 },
    "khsk1": { grade: 11, subject: "Sanskrit_1", numChapters: 11 },
    "khsk2": { grade: 11, subject: "Sanskrit_2", numChapters: 11 },
    // Grade 12
    "lemh1": { grade: 12, subject: "Mathematics_1", numChapters: 6 },
    "lemh2": { grade: 12, subject: "Mathematics_2", numChapters: 7 },
    "leph1": { grade: 12, subject: "Physics_1", numChapters: 8 },
    "leph2": { grade: 12, subject: "Physics_2", numChapters: 6 },
    "lech1": { grade: 12, subject: "Chemistry_1", numChapters: 5 },
    "lech2": { grade: 12, subject: "Chemistry_2", numChapters: 5 },
    "lebo1": { grade: 12, subject: "Biology", numChapters: 13 },
    "lehs1": { grade: 12, subject: "History", numChapters: 4 },
    "lecs1": { grade: 12, subject: "Computer_Science", numChapters: 13 },
    "lhat1": { grade: 12, subject: "Hindi_1", numChapters: 17 },
    "lhar1": { grade: 12, subject: "Hindi_2", numChapters: 15 },
    "lhsk1": { grade: 12, subject: "Sanskrit_1", numChapters: 10 },
    "lhsk2": { grade: 12, subject: "Sanskrit_2", numChapters: 11 },
};

[PDF_DIR, CACHE_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

async function fetchWithRetry(url: string, init: RequestInit, attempts: number = 3) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fetch(url, init);
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await sleep(1000 * attempt);
                continue;
            }
        }
    }
    throw lastError;
}
async function downloadBook(code: string, numChapters: number, destDir: string, grade: number, subject: string) {
    // Check if all expected PDFs already exist before doing any network requests
    let allPdfsExist = true;
    for (let ch = 1; ch <= numChapters; ch++) {
        const filename = `${code}${ch.toString().padStart(2, '0')}.pdf`;
        if (!fs.existsSync(path.join(destDir, filename))) {
            allPdfsExist = false;
            break;
        }
    }
    if (allPdfsExist) {
        return; // Skip completely if already downloaded
    }

    const zipUrl = `https://ncert.nic.in/textbook/pdf/${code}dd.zip`;
    let zipSuccess = false;
    try {
        const response = await fetchWithRetry(zipUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            }
        });
        if (response.ok) {
            const buffer = await response.arrayBuffer();
            const zip = new AdmZip(Buffer.from(buffer));
            const entries = zip.getEntries();
            let extractedCount = 0;
            for (let ch = 1; ch <= numChapters; ch++) {
                const filename = `${code}${ch.toString().padStart(2, '0')}.pdf`;
                // Use endsWith because NCERT zips often have nested folders (e.g., 'cemm1/cemm101.pdf')
                const entry = entries.find(e => e.entryName.toLowerCase().endsWith(filename.toLowerCase()));
                if (!entry) {
                    console.warn(`[Warning] Missing ${filename} in zip archive`);
                    continue;
                }

                const destPath = path.join(destDir, filename);
                if (!fs.existsSync(destPath)) {
                    fs.writeFileSync(destPath, entry.getData());
                    const meta = { grade, subject, book_code: code, chapter: ch, source: "NCERT_nic_in_zip", url: zipUrl, downloaded_at: new Date().toISOString(), local_file: filename };
                    fs.writeFileSync(path.join(destDir, `${filename}.meta.json`), JSON.stringify(meta, null, 2));
                }
                extractedCount++;
            }
            if (extractedCount > 0) {
                zipSuccess = true;
            } else {
                console.warn(`[Warning] No matching PDFs found in zip for ${code}, falling back...`);
            }
        } else {
            console.warn(`[Warning] zip download failed (HTTP ${response.status}) for ${code}, falling back to individual PDFs...`);
        }
    } catch (e) {
        console.warn(`[Warning] zip download/parse failed for ${code}, falling back to individual PDFs...`);
    }

    // Always try to fetch individual PDFs for any chapter that is still missing
    // This handles cases where zipSuccess is true but the zip was missing some chapters,
    // or zipSuccess is false.
    for (let ch = 1; ch <= numChapters; ch++) {
        const filename = `${code}${ch.toString().padStart(2, '0')}.pdf`;
        const pdfUrl = `https://ncert.nic.in/textbook/pdf/${filename}`;
        const destPath = path.join(destDir, filename);
        if (fs.existsSync(destPath)) continue;

        try {
            const response = await fetchWithRetry(pdfUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
                }
            });
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                fs.writeFileSync(destPath, Buffer.from(buffer));
                const meta = { grade, subject, book_code: code, chapter: ch, source: "NCERT_nic_in_pdf", url: pdfUrl, downloaded_at: new Date().toISOString(), local_file: filename };
                fs.writeFileSync(path.join(destDir, `${filename}.meta.json`), JSON.stringify(meta, null, 2));
            } else {
                console.error(`[Error] Failed to fetch individual PDF ${pdfUrl}: ${response.statusText}`);
            }
        } catch (e) {
            console.error(`[Error] downloading individual PDF ${filename}: `, e);
        }
    }
}

async function extractTextFromPdf(pdfPath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(pdfPath);
    if (dataBuffer.length < 1000) {
        throw new Error("PDF file is too small, likely corrupted or an empty HTML page.");
    }
    const parser = new PDFParse(new Uint8Array(dataBuffer));

    // Suppress annoying standardFontDataUrl and missing glyf table warnings from pdfjs-dist
    const originalWarn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && (
            args[0].includes('standardFontDataUrl') ||
            args[0].includes('glyf') ||
            args[0].includes('undefined function') ||
            args[0].includes('translateFont')
        )) return;
        originalWarn(...args);
    };

    let text = "";
    try {
        const data = await parser.getText();
        text = data.text;
    } finally {
        console.warn = originalWarn;
    }

    return text;
}

/** Extract a meaningful chapter title from the first lines of the PDF text */
function extractChapterTitle(text: string, chapter: number): string {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 120);
    // Look for a line containing "Chapter" or a numbered heading near the top
    for (const line of lines.slice(0, 40)) {
        if (/^chapter\s+\d+/i.test(line) || /^\d+\.\s+[A-Z]/.test(line)) {
            return line.replace(/^chapter\s+\d+[\s:–-]*/i, '').trim() || line;
        }
    }
    // Fallback: first line that looks like a title (all caps or Title Case, 4-60 chars)
    for (const line of lines.slice(0, 20)) {
        if (line.length >= 4 && line.length <= 60 && /^[A-Z]/.test(line) && !/^\d/.test(line)) {
            return line;
        }
    }
    return `Chapter ${chapter}`;
}

function chunkText(text: string, maxChars: number = 2000, overlap: number = 200): string[] {
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    const chunks: string[] = [];
    let current = "";

    for (const para of paragraphs) {
        if (current.length + para.length > maxChars && current.length > 0) {
            chunks.push(current);
            current = current.slice(current.length - overlap);
        }
        current += (current ? "\n\n" : "") + para;

        while (current.length > maxChars) {
            chunks.push(current.substring(0, maxChars));
            current = current.substring(maxChars - overlap);
        }
    }
    if (current.length > 50) chunks.push(current);
    return chunks;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tagChunks(chunks: string[], grade: number, subject: string): Promise<any[]> {
    const numbered = chunks.map((c, i) => {
        let text = c.substring(0, 600);
        if (typeof text.toWellFormed === 'function') {
            text = text.toWellFormed();
        } else {
            // Remove unpaired surrogates manually
            text = text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
                .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
        }
        // Also strip any control characters that might cause issues (excluding newlines/tabs)
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        return `[${i + 1}] ${text}`;
    }).join("\n\n");
    const expectedTemplate = "{\n  \"tags\": {\n" +
        chunks.map((_, i) => `    "${i + 1}": {
      "bloom_level": "<CHOOSE EXACTLY ONE: remember, understand, apply, analyse, evaluate, create>",
      "topic": "<Write a 5-10 word summary of the concept covered>",
      "difficulty": "<CHOOSE EXACTLY ONE: easy, medium, hard>"
    }`).join(",\n") +
        "\n  }\n}";

    const prompt = `Grade: ${grade}, Subject: ${subject}

You are given ${chunks.length} numbered chunks of text. You MUST return a JSON object with a single key "tags", which contains a dictionary mapping EXACTLY ${chunks.length} chunk numbers to their tags.

CRITICAL ANTI-HALLUCINATION INSTRUCTIONS:
- You must return exactly ONE JSON object per input chunk number.
- Do NOT break a single chunk into multiple objects.
- The keys in your "tags" dictionary must exactly match the chunk numbers.

Fill out this EXACT JSON template with your answers:
${expectedTemplate}

Chunks:
${numbered}

Output ONLY the JSON object.`;

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const useFallback = attempt >= 2;
            const client = useFallback ? fallbackAi : ai;
            const modelToUse = useFallback ? FALLBACK_MODEL : MODEL;

            if (useFallback) {
                console.log(`  [Fallback] Switching to AI Studio (${FALLBACK_MODEL}) due to previous failures...`);
            }

            const resp = await client.chat.completions.create({
                model: modelToUse,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            });
            let content = resp.choices[0]!.message.content || "[]";

            // 1. Remove <thought> blocks (common in gemma/reasoning models)
            content = content.replace(/<thought>[\s\S]*?<\/thought>/g, '');

            // 2. Extract from markdown JSON block if present
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) content = jsonMatch[1];

            // 3. Fallback: find the first { or [ and last } or ]
            content = content.trim();
            if (!content.startsWith('{') && !content.startsWith('[')) {
                const firstBrace = content.indexOf('{');
                const firstBracket = content.indexOf('[');
                let first = -1;
                if (firstBrace !== -1 && firstBracket !== -1) first = Math.min(firstBrace, firstBracket);
                else if (firstBrace !== -1) first = firstBrace;
                else if (firstBracket !== -1) first = firstBracket;

                if (first !== -1) {
                    content = content.substring(first);
                    const lastBrace = content.lastIndexOf('}');
                    const lastBracket = content.lastIndexOf(']');
                    const last = Math.max(lastBrace, lastBracket);
                    if (last !== -1) content = content.substring(0, last + 1);
                }
            }

            let parsed = JSON.parse(content);
            let parsedTags = parsed.tags || parsed.chunks || parsed.results || parsed.data || parsed.items || parsed;

            let result: any[] = [];
            // Map the parsed data back to exactly `chunks.length` items
            if (Array.isArray(parsedTags)) {
                // If it ignored the dictionary instruction and returned an array anyway
                result = parsedTags.slice(0, chunks.length);
            } else {
                // Extract by dictionary keys "1", "2", etc.
                for (let i = 0; i < chunks.length; i++) {
                    const item = parsedTags[String(i + 1)] || parsedTags[i] || {};
                    result.push(item);
                }
            }

            // Guarantee exact length, filling missing with empty objects
            while (result.length < chunks.length) result.push({});

            for (const item of result) {
                if (!item.topic) item.topic = "General";
            }
            return result;
        } catch (e: any) {
            console.error(`Tagging error (attempt ${attempt + 1}): `, e.message);
            const waitTime = 10000 * Math.pow(2, attempt); // 10s, 20s, 40s
            console.log(`  Sleeping ${waitTime / 1000}s before retrying...`);
            await sleep(waitTime);
        }
    }
    return chunks.map(() => ({ bloom_level: "understand", topic: "General", difficulty: "medium" }));
}

/** Calls LLM per subject to identify prerequisite topic edges */
async function buildCurriculumGraph(db: ReturnType<typeof import('./db-local')['initDb']>) {
    console.log("\nBuilding curriculum graph...");

    // Group distinct topics per grade+subject from content_chunks
    const subjects = db.prepare(`
        SELECT DISTINCT grade, subject FROM content_chunks ORDER BY grade, subject
    `).all() as { grade: number; subject: string }[];

    const edgeInsert = db.prepare(`
        INSERT OR IGNORE INTO curriculum_edges
        (pre_grade, pre_subject, pre_chapter, pre_topic, post_grade, post_subject, post_chapter, post_topic, confidence, rationale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const { grade, subject } of subjects) {
        const alreadyDone = (db.prepare(`
            SELECT COUNT(*) as count FROM curriculum_edges WHERE post_grade = ? AND post_subject = ? COLLATE NOCASE
        `).get(grade, subject) as any).count;
        if (alreadyDone > 0) {
            console.log(`  Skipping Grade ${grade} ${subject} (already has ${alreadyDone} edges)`);
            continue;
        }

        const topics = db.prepare(`
            SELECT DISTINCT topic, chapter FROM content_chunks
            WHERE grade = ? AND subject = ? COLLATE NOCASE AND topic != ''
            ORDER BY chapter, topic
        `).all(grade, subject) as { topic: string; chapter: number }[];

        if (topics.length === 0) continue;

        const topicList = topics.map((t, i) => `${i + 1}. Ch${t.chapter}: ${t.topic}`).join('\n');

        const prompt = `You are a curriculum expert for CBSE Grade ${grade} ${subject}.

Below is a list of topics from this textbook. Identify the PREREQUISITE relationships — which earlier topics must be understood before a later topic.

Topics:
${topicList}

Return a JSON array of prerequisite edges. Each edge:
{
  "pre_topic": "earlier topic name (exactly as listed)",
  "pre_chapter": <chapter number>,
  "post_topic": "later topic that requires it (exactly as listed)",
  "post_chapter": <chapter number>,
  "confidence": <0.5-1.0>,
  "rationale": "one sentence why"
}

Return ONLY the JSON array. Omit trivial or obvious ordering edges. Focus on conceptual dependencies.`;

        try {
            const resp = await ai.chat.completions.create({
                model: MODEL,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            });
            let content = resp.choices[0]!.message.content || "[]";
            let parsed = JSON.parse(content);
            if (!Array.isArray(parsed) && parsed.edges) parsed = parsed.edges;
            if (!Array.isArray(parsed)) { console.warn(`  No edges for Grade ${grade} ${subject}`); continue; }

            const insertMany = db.transaction((edges: any[]) => {
                for (const e of edges) {
                    if (!e.pre_topic || !e.post_topic) continue;
                    edgeInsert.run(
                        grade, subject, e.pre_chapter ?? 0, e.pre_topic,
                        grade, subject, e.post_chapter ?? 0, e.post_topic,
                        e.confidence ?? 0.8, e.rationale ?? ""
                    );
                }
            });
            insertMany(parsed);
            console.log(`  Grade ${grade} ${subject}: ${parsed.length} edges`);
            await sleep(2000);
        } catch (e: any) {
            console.error(`  Graph error for Grade ${grade} ${subject}: `, e.message);
        }
    }
    console.log("Curriculum graph done.");
}

async function main() {
    const db = initDb();
    const searchIndex = getSearchIndex();

    // ── Step 1: Download PDFs ──────────────────────────────────────────────
    console.log("Step 1/3: Downloading NCERT PDFs...");
    for (const [code, info] of Object.entries(NCERT_TEXTBOOK_CHAPTERS)) {
        const destDir = path.join(PDF_DIR, `grade_${info.grade}`, info.subject);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const markerPath = path.join(destDir, `${code}_download_complete.marker`);

        let existing = 0;
        for (let ch = 1; ch <= info.numChapters; ch++) {
            if (fs.existsSync(path.join(destDir, `${code}${ch.toString().padStart(2, '0')}.pdf`))) existing++;
        }

        // Only download if we don't have the marker AND we're missing files
        if (existing < info.numChapters && !fs.existsSync(markerPath)) {
            console.log(`  Downloading Grade ${info.grade} ${info.subject} (${code})...`);
            await downloadBook(code, info.numChapters, destDir, info.grade, info.subject);
            // Mark as complete so we don't infinitely retry 404s on subsequent runs
            fs.writeFileSync(markerPath, "done");
        }
    }

    // ── Step 2: Chunk → Tag → Store ────────────────────────────────────────
    console.log("\nStep 2/3: Processing chapters...");
    const checkStmt = db.prepare(`SELECT COUNT(*) as count FROM content_chunks WHERE source_file = ?`);
    const insertChunkStmt = db.prepare(`
        INSERT OR IGNORE INTO content_chunks 
        (source_file, grade, subject, chapter, chunk_index, text, bloom_level, topic, difficulty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItemStmt = db.prepare(`
        INSERT OR IGNORE INTO content_items (book_code, grade, subject, chapter_num, title)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const [code, info] of Object.entries(NCERT_TEXTBOOK_CHAPTERS)) {
        const dir = path.join(PDF_DIR, `grade_${info.grade}`, info.subject);
        if (!fs.existsSync(dir)) continue;

        for (let ch = 1; ch <= info.numChapters; ch++) {
            const filename = `${code}${ch.toString().padStart(2, '0')}.pdf`;
            const pdfPath = path.join(dir, filename);
            if (!fs.existsSync(pdfPath)) continue;

            const existingCount = (checkStmt.get(filename) as any).count;
            const cacheFile = path.join(CACHE_DIR, `grade_${info.grade}_${info.subject}_ch${ch.toString().padStart(2, '0')}.txt`);

            if (existingCount > 0 && fs.existsSync(cacheFile)) continue;

            console.log(`  Processing ${filename}...`);
            let text = "";
            try {
                text = await extractTextFromPdf(pdfPath);
            } catch (e) {
                console.error(`[Warning] Failed to parse PDF ${pdfPath}, skipping. Error: ${(e as Error).message}`);
                continue;
            }

            // Write text cache so get_chapter() works without re-parsing PDF
            if (!fs.existsSync(cacheFile)) {
                fs.writeFileSync(cacheFile, text, 'utf-8');
            }

            // If we already have the chunks in the DB, we only needed to restore the cache file.
            if (existingCount > 0) continue;

            // Extract and store chapter title
            const title = extractChapterTitle(text, ch);
            insertItemStmt.run(code, info.grade, info.subject, ch, title);

            const chunks = chunkText(text);
            if (chunks.length === 0) continue;

            const tags: any[] = [];
            for (let i = 0; i < chunks.length; i += 5) {
                const batch = chunks.slice(i, i + 5);
                const batchTags = await tagChunks(batch, info.grade, info.subject);
                tags.push(...batchTags);
                await sleep(2500);
            }

            const insertTransaction = db.transaction((chunkData: any[]) => {
                for (const item of chunkData) {
                    insertChunkStmt.run(
                        item.source_file, item.grade, item.subject, item.chapter,
                        item.chunk_index, item.text, item.bloom_level, item.topic, item.difficulty
                    );
                }
            });

            const dbRows = [];
            for (let i = 0; i < chunks.length; i++) {
                const tag = tags[i] || {};
                const id = `${filename}_${i}`;

                dbRows.push({
                    source_file: filename, grade: info.grade, subject: info.subject,
                    chapter: ch, chunk_index: i, text: chunks[i],
                    bloom_level: tag.bloom_level || "understand",
                    topic: tag.topic || "General", difficulty: tag.difficulty || "medium"
                });

                const doc = {
                    id,
                    source_file: filename,
                    grade: info.grade,
                    subject: info.subject,
                    chapter: ch,
                    chunk_index: i,
                    bloom_level: tag.bloom_level || "understand",
                    topic: tag.topic || "General",
                    difficulty: tag.difficulty || "medium",
                    text: chunks[i]!.substring(0, 1000)
                };

                if (searchIndex.has(id)) {
                    searchIndex.replace(doc);
                } else {
                    searchIndex.add(doc);
                }
            }

            insertTransaction(dbRows);
            saveSearchIndex(searchIndex);
        }
    }

    // ── Step 3: Build curriculum graph ─────────────────────────────────────
    console.log("\nStep 3/3: Building curriculum graph...");
    await buildCurriculumGraph(db);

    console.log("\n✓ Ingestion complete.");
}

main().catch(console.error);
