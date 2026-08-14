import { Database } from 'bun:sqlite';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const db = new Database('./data/content.db');

const ai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY
});

const items = db.query(`
    SELECT id, book_code, book_title, chapter_num, title, subject, grade
    FROM content_items 
    WHERE title NOT LIKE 'Chapter %'
`).all();

const noiseItems = items.filter((i: any) => {
    const t = i.title || '';
    if (t.length > 40) return true;
    if (/[;\[\]\{\}\%\^¿_]/.test(t)) return true;
    if (/^[0-9]+[\.\-\)\s]/.test(t)) return true;
    if (t.toLowerCase() === 'hindi' || t.toLowerCase() === 'english' || t.toLowerCase() === 'sanskrit') return true;
    if (t.toLowerCase().includes('introduction to')) return true;
    if (t.startsWith('1 ') || t.startsWith('2 ')) return true;
    return false;
});

console.log(`Found ${noiseItems.length} noisy titles.`);

async function run() {
    const updateStmt = db.prepare('UPDATE content_items SET title = ? WHERE id = ?');
    let updated = 0;

    for (const item of noiseItems as any[]) {
        const prompt = `You are an expert on Indian NCERT textbooks.
I have a chapter from an NCERT book, but its title was corrupted (due to Kruti Dev font or bad extraction).
Book Title: ${item.book_title}
Subject: ${item.subject}
Class/Grade: ${item.grade}
Chapter Number: ${item.chapter_num}
Corrupted Title: ${item.title}

Please tell me the ACTUAL correct chapter title in the correct language (Hindi, Sanskrit, or English) for Chapter ${item.chapter_num} of this specific NCERT book.
DO NOT include any prefixes like "Chapter ${item.chapter_num}:". Return ONLY the exact title string.`;

        try {
            const response = await ai.chat.completions.create({
                model: 'meta/llama-3.1-70b-instruct',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0
            });
            const content = response.choices[0]?.message?.content;
            if (content) {
                let finalTitle = content.replace(/^["']|["']$/g, '').trim();
                finalTitle = finalTitle.replace(new RegExp(`^(Chapter|पाठ|अध्याय)\\s*${item.chapter_num}\\s*[:-]?\\s*`, 'i'), '').trim();
                if (finalTitle && finalTitle.length < 100 && !finalTitle.includes('\n')) {
                    updateStmt.run(finalTitle, item.id);
                    console.log(`Fixed: ${item.book_code} Ch ${item.chapter_num} -> ${finalTitle}`);
                    updated++;
                }
            }
        } catch (e) {
            console.error(e);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    console.log(`Successfully fixed ${updated} noisy titles.`);
}

run();
