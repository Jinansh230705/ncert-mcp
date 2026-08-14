/// <reference types="bun-types" />
import { Database } from 'bun:sqlite';
import path from 'path';

async function main() {
    console.log("Fetching NCERT textbook page...");
    const res = await fetch("https://ncert.nic.in/textbook.php", {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        }
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.statusText}`);
    }
    const html = await res.text();

    console.log("Parsing book titles from JavaScript...");
    // The HTML has lines like:
    // if(pm=="aejm1") { document.write("<tr valign='top'><td class='st1' bgcolor='#981F4D' style='color:white' height='25' width='100%'><strong>Joyful-Mathematics (English)</strong></br></td></tr>"); }
    const regex = /if\(pm==\"([a-zA-Z0-9_]+)\"\)\s*\{\s*document\.write\(.*?<strong>(.*?)<\/strong>/g;
    
    const bookTitleMap: Record<string, string> = {};
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null) {
        if (match[1] && match[2]) {
            bookTitleMap[match[1]] = match[2].trim();
        }
        count++;
    }
    
    console.log(`Found ${count} book titles on the NCERT website.`);

    // Connect to database
    const dbPath = path.join(__dirname, '../data/content.db');
    console.log(`Connecting to database at ${dbPath}...`);
    const db = new Database(dbPath);

    // Read pipeline.ts to get the grade/subject mapping
    const fs = require('fs');
    const pipelinePath = path.join(__dirname, '../src/pipeline.ts');
    let pipelineContent = fs.readFileSync(pipelinePath, 'utf8');
    const dictStart = pipelineContent.indexOf('const NCERT_TEXTBOOK_CHAPTERS: Record<string, { grade: number, subject: string, numChapters: number }> = {');
    const dictEnd = pipelineContent.indexOf('};', dictStart);
    const dictString = pipelineContent.substring(dictStart, dictEnd + 1);
    
    const equalSign = dictString.indexOf('=');
    const objectString = dictString.substring(dictString.indexOf('{', equalSign));
    const NCERT_TEXTBOOK_CHAPTERS = eval(`(${objectString})`);

    let updatedCount = 0;
    const updateStmt = db.prepare(`UPDATE content_items SET book_title = ? WHERE grade = ? AND LOWER(subject) = LOWER(?)`);

    for (const [code, info] of Object.entries(NCERT_TEXTBOOK_CHAPTERS)) {
        const title = bookTitleMap[code];
        if (title) {
            updateStmt.run(title, (info as any).grade, (info as any).subject);
            updatedCount++;
            console.log(`Updated [${code}] (Grade ${(info as any).grade} ${(info as any).subject}) -> "${title}"`);
        } else {
            console.log(`[Warning] Book code ${code} not found on NCERT website!`);
        }
    }

    console.log(`Successfully updated ${updatedCount} books with official titles.`);
    db.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
