/// <reference types="bun-types" />
import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'data', 'content.db');
const db = new Database(dbPath);

const mapPath = path.join(process.cwd(), 'data', 'chapters_map.json');

async function main() {
    if (!fs.existsSync(mapPath)) {
        throw new Error("chapters_map.json not found!");
    }

    const chaptersMap: Record<string, string[]> = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

    const updateStmt = db.prepare(`
        UPDATE content_items
        SET title = ?
        WHERE book_code = ? AND chapter_num = ?
    `);

    let totalUpdated = 0;

    for (const [bookCode, chapters] of Object.entries(chaptersMap)) {
        console.log(`Processing ${bookCode}...`);
        
        for (let i = 0; i < chapters.length; i++) {
            const chapterNum = i + 1;
            const chapterTitle = chapters[i];

            if (chapterTitle) {
                const info = updateStmt.run(chapterTitle, bookCode, chapterNum);
                if (info.changes > 0) {
                    totalUpdated += info.changes;
                    console.log(`  -> Updated Chapter ${chapterNum} to "${chapterTitle}"`);
                }
            }
        }
    }

    console.log(`Successfully updated ${totalUpdated} chapters with accurate names!`);
    db.close();
}

main().catch(console.error);
