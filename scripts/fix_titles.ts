/// <reference types="bun-types" />
import { Database } from 'bun:sqlite';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ override: true });

const ai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY || "dummy",
});
// Using 70b if available, otherwise fallback to whatever is in env
const MODEL = "meta/llama-3.1-70b-instruct"; 

const dbPath = path.join(process.cwd(), 'data', 'content.db');
const db = new Database(dbPath);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTitleWithRetries(text: string, maxRetries = 5) {
    const prompt = `You are a strict data extraction assistant. I will give you the first page of an NCERT textbook chapter.
Your ONLY task is to accurately extract the exact Chapter Title.
CRITICAL RULES:
1. Do NOT include the chapter number (e.g., return "A Letter to God", not "Chapter 1: A Letter to God").
2. Ignore textbook preambles and instructions like "Let us read", "Let us do", "Teacher's Note", "Unit 1", or "Objective".
3. Return ONLY a valid JSON object.

Return format:
{
  "chapter_title": "exact title here"
}

Text:
${text.substring(0, 1500)}
`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const resp = await ai.chat.completions.create({
                model: MODEL,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            });

            let content = resp.choices[0]!.message.content || "{}";
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) content = jsonMatch[1];
            
            const parsed = JSON.parse(content);
            return parsed.chapter_title;
        } catch (e: any) {
            if (e.status === 429) {
                console.warn(`    [Rate Limit 429] Waiting ${attempt * 3} seconds before retry...`);
                await sleep(attempt * 3000);
            } else {
                throw e; // other errors throw immediately
            }
        }
    }
    throw new Error("Max retries exceeded for 429 Too Many Requests");
}

async function main() {
    // We already have book_title correctly populated by scrape_book_titles.ts.
    // Now we strictly focus on chapter titles.
    const chapters = db.prepare(`
        SELECT i.book_code, i.chapter_num, c.text, i.title as old_title
        FROM content_items i
        JOIN content_chunks c ON i.book_code = substr(c.source_file, 1, 5) AND i.chapter_num = c.chapter
        WHERE c.chunk_index = 0
        ORDER BY i.book_code, i.chapter_num
    `).all() as any[];

    console.log(`Found ${chapters.length} chapters to process.`);

    const updateStmt = db.prepare(`
        UPDATE content_items
        SET title = ?
        WHERE book_code = ? AND chapter_num = ?
    `);

    let count = 0;
    for (const chapter of chapters) {
        count++;
        
        // Skip chapters that already seem correctly extracted (to save time/credits)
        // Heuristic: If it has a title that is > 2 chars and doesn't look like a raw fallback
        const isFallback = !chapter.old_title || chapter.old_title.toLowerCase().startsWith("chapter ") || chapter.old_title.includes("Let us") || chapter.old_title === "Unknown";
        
        if (!isFallback) {
            console.log(`[${count}/${chapters.length}] Skipping Book: ${chapter.book_code}, Chapter: ${chapter.chapter_num} - Title looks good: ${chapter.old_title}`);
            continue;
        }

        try {
            console.log(`[${count}/${chapters.length}] Book: ${chapter.book_code}, Chapter: ${chapter.chapter_num}`);
            
            const title = await fetchTitleWithRetries(chapter.text);
            const finalTitle = title || `Chapter ${chapter.chapter_num}`;
            
            console.log(`  -> Extracted: "${finalTitle}"`);
            updateStmt.run(finalTitle, chapter.book_code, chapter.chapter_num);
            
            // Respectful delay to avoid hitting rate limits too quickly
            await sleep(800);
        } catch (e: any) {
            console.error(`  -> Failed for ${chapter.book_code} Ch ${chapter.chapter_num}:`, e.message);
        }
    }

    console.log("Done updating chapter titles.");
}

main().catch(console.error);
