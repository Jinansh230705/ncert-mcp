import { Database } from 'bun:sqlite';
import path from 'path';

const db = new Database(path.join(__dirname, '../data/content.db'));

const rows = db.query(`
    SELECT source_file, text 
    FROM content_chunks 
    WHERE chunk_index = 0 
    ORDER BY RANDOM() 
    LIMIT 20
`).all() as any[];

for (const row of rows) {
    const lines = row.text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    
    let title = "Unknown";
    
    // Simple heuristic: find the chapter number line, and take the next non-empty line
    // or just take the first few lines that are not single characters
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];
        if (
            line.toLowerCase().includes('chapter') || 
            line.toLowerCase().includes('unit') ||
            line.toLowerCase().includes('अध्याय') ||
            line.match(/^[0-9]+$/)
        ) {
            if (i + 1 < lines.length) {
                // If the next line is very short, maybe take the one after
                if (lines[i+1].length < 3 && i + 2 < lines.length) {
                    title = lines[i+2];
                } else {
                    title = lines[i+1];
                }
                // Break after finding the first valid looking title
                break;
            }
        }
    }
    
    // Fallback: just take the longest line in the first 3 lines
    if (title === "Unknown" && lines.length > 0) {
        let maxLen = 0;
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            if (lines[i].length > maxLen && lines[i].length < 100) {
                maxLen = lines[i].length;
                title = lines[i];
            }
        }
    }

    console.log(`[${row.source_file}]`);
    console.log(`Extracted: ${title}`);
    console.log(`First few lines: ${lines.slice(0, 4).join(" | ")}`);
    console.log("-----------------------");
}

db.close();
