/// <reference types="bun-types" />
import { Database } from 'bun:sqlite';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ override: true });

const ai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENAI_API_KEY || "dummy",
});
// Using 8b to avoid strict rate limits on 70b, since web text is clean
const MODEL = process.env.MODEL_NAME || "meta/llama-3.1-8b-instruct";

const dbPath = path.join(process.cwd(), 'data', 'content.db');
const db = new Database(dbPath);

const pipelinePath = path.join(__dirname, '../src/pipeline.ts');
let pipelineContent = fs.readFileSync(pipelinePath, 'utf8');
const dictStart = pipelineContent.indexOf('const NCERT_TEXTBOOK_CHAPTERS: Record<string, { grade: number, subject: string, numChapters: number }> = {');
const dictEnd = pipelineContent.indexOf('};', dictStart);
const dictString = pipelineContent.substring(dictStart, dictEnd + 1);
const equalSign = dictString.indexOf('=');
const objectString = dictString.substring(dictString.indexOf('{', equalSign));
const NCERT_TEXTBOOK_CHAPTERS = eval(`(${objectString})`);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function searchWeb(query: string) {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = await res.text();
    // Extract text snippets
    const snippets = [];
    const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/gs;
    let match;
    while ((match = regex.exec(html)) !== null) {
        // clean html tags
        const snippet = match[1];
        if (snippet) {
            snippets.push(snippet.replace(/<[^>]*>/g, '').trim());
        }
    }
    return snippets.join('\n\n');
}

async function getChaptersWithRetries(bookTitle: string, subject: string, grade: number, numChapters: number, maxRetries = 3) {
    const query = `NCERT Class ${grade} ${subject} ${bookTitle} all chapter names list`;
    console.log(`    Searching: "${query}"`);
    const searchResults = await searchWeb(query);
    
    if (!searchResults) {
        console.warn(`    No search results found for ${query}`);
    }

    const prompt = `You are a data extraction assistant.
I am providing you with web search snippets for the query: "${query}".
Your task is to identify and list the exact names of all ${numChapters} chapters for this book.
CRITICAL RULES:
1. Return EXACTLY a JSON array of strings. Do not include chapter numbers (e.g. return "Two Little Hands", not "Chapter 1: Two Little Hands").
2. The array must contain exactly ${numChapters} strings.
3. Return ONLY valid JSON array. Do not wrap in an object.

Search Results:
${searchResults.substring(0, 4000)}
`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const resp = await ai.chat.completions.create({
                model: MODEL,
                messages: [{ role: "user", content: prompt }]
            });

            let content = resp.choices[0]!.message.content || "[]";
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) content = jsonMatch[1];
            
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed.length >= numChapters - 2) {
                // Return exact amount to match numChapters if possible
                return parsed.slice(0, numChapters);
            }
            throw new Error(`Parsed result is not a valid array or has wrong length: ${parsed.length} instead of ${numChapters}`);
        } catch (e: any) {
            console.warn(`    Attempt ${attempt} failed: ${e.message}`);
            if (e.status === 429) {
                await sleep(3000 * attempt);
            }
        }
    }
    return null;
}

async function main() {
    const rows = db.query(`
        SELECT DISTINCT substr(source_file, 1, 5) as book_code, book_title 
        FROM content_items i 
        JOIN content_chunks c ON substr(c.source_file, 1, 5) = i.book_code
    `).all() as any[];

    console.log(`Found ${rows.length} distinct book codes.`);

    const chaptersMap: Record<string, string[]> = {};
    const mapPath = path.join(process.cwd(), 'data', 'chapters_map.json');

    // Load existing to allow resuming
    if (fs.existsSync(mapPath)) {
        Object.assign(chaptersMap, JSON.parse(fs.readFileSync(mapPath, 'utf8')));
    }

    let count = 0;
    for (const row of rows) {
        count++;
        if (!row.book_title) continue;
        
        const info = NCERT_TEXTBOOK_CHAPTERS[row.book_code];
        if (!info) continue;

        const mappedChapters = chaptersMap[row.book_code];
        if (mappedChapters && mappedChapters.length >= info.numChapters) {
            console.log(`[${count}/${rows.length}] Skipping ${row.book_code} (${row.book_title}) - already mapped`);
            continue;
        }

        console.log(`[${count}/${rows.length}] Mapping ${row.book_code}: Class ${info.grade} ${info.subject} "${row.book_title}" (${info.numChapters} chapters)`);
        
        const chapters = await getChaptersWithRetries(row.book_title, info.subject, info.grade, info.numChapters);
        
        if (chapters) {
            chaptersMap[row.book_code] = chapters;
            fs.writeFileSync(mapPath, JSON.stringify(chaptersMap, null, 2));
            console.log(`    Saved ${chapters.length} chapters.`);
        } else {
            console.error(`    Failed to generate map for ${row.book_code}`);
        }
        
        await sleep(2000); // respect DDG limit
    }

    console.log("Done building chapters_map.json");
    db.close();
}

main().catch(console.error);
