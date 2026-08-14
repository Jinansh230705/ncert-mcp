import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';

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

const oldBooksData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'books.json'), 'utf8')).result;

const rows = db.query(`
    SELECT DISTINCT substr(source_file, 1, 5) as book_code, book_title 
    FROM content_items i 
    JOIN content_chunks c ON substr(c.source_file, 1, 5) = i.book_code
`).all() as any[];

const chaptersMap: Record<string, string[]> = {};
let mappedCount = 0;
const missing: string[] = [];

for (const row of rows) {
    if (!row.book_title) continue;
    
    const info = NCERT_TEXTBOOK_CHAPTERS[row.book_code];
    if (!info) continue;

    const newTitles = ['Mridang', 'Sarangi', 'Joyful', 'Maths Mela', 'Math-Mela', 'Math Mela', 'Santoor', 'Veena', 'Our Wondrous World', 'Our Wonderous World', 'Curiosity', 'Exploring Society', 'Poorvi', 'Malhar', 'Deepakam', 'Kaveri', 'Ganga', 'Sharada', 'Exploration', 'Ganita'];
    const isNew = newTitles.some(t => row.book_title.includes(t));
    
    if (isNew) {
        missing.push(row.book_code);
        continue;
    }

    // Try to find in oldBooks
    let cName = 'Class ' + info.grade;
    let sName = info.subject.toLowerCase();
    
    const matches = oldBooksData.filter((b: any) => {
        if (b.className !== cName) return false;
        const bSub = b.subjectName.toLowerCase();
        // lenient matching
        if (sName.includes('math') && bSub.includes('math')) return true;
        if (sName.includes('science') && bSub.includes('science')) return true;
        if (sName.includes('history') && bSub.includes('history')) return true;
        if (sName.includes('geography') && bSub.includes('geography')) return true;
        if (sName.includes('physics') && bSub.includes('physics')) return true;
        if (sName.includes('chemistry') && bSub.includes('chemistry')) return true;
        if (sName.includes('biology') && bSub.includes('biology')) return true;
        if (sName.includes('english') && bSub.includes('english')) return true;
        
        // Hindi/Sanskrit translations
        const titleL = row.book_title.toLowerCase();
        if (titleL.includes('kshitij') && bSub.includes('क्षितिज')) return true;
        if (titleL.includes('sparsh') && bSub.includes('स्पर्श')) return true;
        if (titleL.includes('aroh') && bSub.includes('आरोह')) return true;
        if (titleL.includes('antra') && bSub.includes('अंतरा')) return true;
        if (titleL.includes('bhaswati') && bSub.includes('भास्वती')) return true;
        if (titleL.includes('shashwati') && bSub.includes('शाश्वती')) return true;
        if (titleL.includes('shaswati') && bSub.includes('शाश्वती')) return true;
        if (titleL.includes('shemushi') && bSub.includes('शेमुषी')) return true;

        if (sName.includes('hindi') && bSub.includes('hindi')) return true;
        if (sName.includes('sanskrit') && bSub.includes('sanskrit')) return true;
        if (sName.includes('computer') && bSub.includes('computer')) return true;
        return bSub === sName || bSub.includes(sName) || sName.includes(bSub);
    });

    if (matches.length > 0) {
        // Since there could be multiple books for a subject in that class (e.g. English has Honeycomb, An Alien Hand)
        // we must match by book title if possible
        const rowTitleLower = row.book_title.toLowerCase();
        let bestMatch = matches;
        
        // try to filter by pathName containing parts of the book title
        const filtered = matches.filter((m: any) => {
            const safeTitle = rowTitleLower.replace(/[^a-z0-9]/g, '');
            return m.pathName && m.pathName.toLowerCase().includes(safeTitle.substring(0, 4));
        });
        
        if (filtered.length >= info.numChapters) {
            bestMatch = filtered;
        }

        const chapters = bestMatch.map((m: any) => {
            const parts = m.chapterName.split(':');
            if (parts.length > 1) return parts.slice(1).join(':').trim();
            return m.chapterName.trim();
        });
        
        // Take the first N chapters up to info.numChapters
        if (chapters.length >= info.numChapters) {
            chaptersMap[row.book_code] = chapters.slice(0, info.numChapters);
            mappedCount++;
        } else {
            console.log(`Not enough chapters for ${row.book_code} in books.json: found ${chapters.length}, needed ${info.numChapters}`);
            missing.push(row.book_code);
        }
    } else {
        missing.push(row.book_code);
    }
}

fs.writeFileSync(path.join(process.cwd(), 'data', 'chapters_map.json'), JSON.stringify(chaptersMap, null, 2));

console.log(`Mapped ${mappedCount} classic books from books.json.`);
console.log(`Missing ${missing.length} books (mostly new NEP books).`);
console.log(missing.join(', '));
