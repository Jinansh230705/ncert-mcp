import { Database } from 'bun:sqlite';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const db = new Database('./data/content.db');

const ai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY
});

// We only want to process items that have a generic "Chapter X" title
interface ContentItem {
    id: number;
    book_code: string;
    chapter: number;
    title: string;
    grade: number;
    subject: string;
}

const genericItems = db.query(`
    SELECT c.id, c.book_code, c.chapter_num as chapter, c.title, c.grade, c.subject
    FROM content_items c
    WHERE c.title LIKE 'Chapter %'
`).all() as ContentItem[];

console.log(`Found ${genericItems.length} chapters with generic names.`);

async function extractTitle(text: string, subject: string, chapterNum: number): Promise<string> {
    const prompt = `You are extracting the exact chapter title from an NCERT textbook chunk.
The subject is "${subject}". This is Chapter ${chapterNum}.
Read the following text chunk (which is the beginning of the chapter) and extract the exact title of the chapter.
DO NOT include "Chapter X:" or any other prefix. DO NOT put quotes around the title.
Return ONLY the chapter name in the exact language of the text (e.g. Hindi if the text is Hindi, English if English).

Text chunk:
${text.substring(0, 3000)}`;

    try {
        const response = await ai.chat.completions.create({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0
        });
        const content = response.choices[0]?.message?.content;
        return content ? content.trim() : `Chapter ${chapterNum}`;
    } catch (e) {
        console.error("LLM Error:", e);
        return `Chapter ${chapterNum}`;
    }
}

async function run() {
    const updateStmt = db.prepare('UPDATE content_items SET title = ? WHERE id = ?');
    let updated = 0;

    const batchSize = 25;
    
    for (let i = 0; i < genericItems.length; i += batchSize) {
        const batch = genericItems.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(genericItems.length / batchSize)}...`);
        
        for (const item of batch) {
            let chapterStr = item.chapter.toString().padStart(2, '0');
            const searchStr = `${item.book_code}${chapterStr}%`;
            
            const chunk = db.query(`
                SELECT text 
                FROM content_chunks 
                WHERE source_file LIKE ? 
                ORDER BY chunk_index ASC 
                LIMIT 1
            `).get(searchStr) as any;

            if (!chunk || !chunk.text) {
                console.log(`No chunk found for ${item.book_code} Chapter ${item.chapter}`);
                continue;
            }

            const title = await extractTitle(chunk.text, item.subject, item.chapter);
            
            let finalTitle = title.replace(/^["']|["']$/g, '').trim();
            if (finalTitle.toLowerCase().startsWith(`chapter ${item.chapter}:`)) {
                finalTitle = finalTitle.substring(`chapter ${item.chapter}:`.length).trim();
            }
            if (finalTitle.toLowerCase().startsWith(`chapter ${item.chapter} -`)) {
                finalTitle = finalTitle.substring(`chapter ${item.chapter} -`.length).trim();
            }
            if (finalTitle.toLowerCase().startsWith('पाठ')) {
                finalTitle = finalTitle.replace(/^पाठ\s*\d+\s*[-:]?\s*/i, '').trim();
            }
            if (finalTitle.toLowerCase().startsWith('अध्याय')) {
                finalTitle = finalTitle.replace(/^अध्याय\s*\d+\s*[-:]?\s*/i, '').trim();
            }
            
            if (finalTitle.length > 0 && finalTitle.length < 100 && !finalTitle.includes('\n')) {
                updateStmt.run(finalTitle, item.id);
                updated++;
                console.log(`Updated ${item.book_code} Ch ${item.chapter} -> ${finalTitle}`);
            } else {
                console.log(`Rejected title for ${item.book_code} Ch ${item.chapter}: ${finalTitle}`);
            }
            
            // tiny delay to respect rate limits
            await new Promise(r => setTimeout(r, 1200));
        }
    }
    
    console.log(`Successfully updated ${updated} chapter titles.`);
}

run();
