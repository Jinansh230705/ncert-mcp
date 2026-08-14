import * as fs from 'fs';
import * as path from 'path';

// Parse pipeline.ts to extract NCERT_TEXTBOOK_CHAPTERS
const pipelinePath = path.join(__dirname, '../src/pipeline.ts');
let pipelineContent = fs.readFileSync(pipelinePath, 'utf8');

// We use regex to parse the hardcoded dictionary safely
const dictStart = pipelineContent.indexOf('const NCERT_TEXTBOOK_CHAPTERS: Record<string, { grade: number, subject: string, numChapters: number }> = {');
if (dictStart === -1) {
    console.error("Could not find NCERT_TEXTBOOK_CHAPTERS in pipeline.ts");
    process.exit(1);
}
const dictEnd = pipelineContent.indexOf('};', dictStart);
const dictString = pipelineContent.substring(dictStart, dictEnd + 1);

// Evaluate it to a JS object (using eval is safe here because it's our own code)
let NCERT_TEXTBOOK_CHAPTERS: Record<string, { grade: number, subject: string, numChapters: number }>;
try {
    // Strip the const declaration to just get the object
    const equalSign = dictString.indexOf('=');
    const objectString = dictString.substring(dictString.indexOf('{', equalSign));
    NCERT_TEXTBOOK_CHAPTERS = eval(`(${objectString})`);
} catch (e) {
    console.error("Failed to parse NCERT_TEXTBOOK_CHAPTERS", e);
    process.exit(1);
}

async function main() {
    let dataUrl = process.env.DATA_JSON_URL;
    let dataJson: any;

    if (dataUrl) {
        console.log(`Fetching data.json from ${dataUrl}...`);
        const res = await fetch(dataUrl);
        if (!res.ok) throw new Error(`Failed to fetch data.json: ${res.statusText}`);
        dataJson = await res.json();
    } else {
        const localPath = path.join(__dirname, '../../data.json');
        console.log(`Reading local data.json from ${localPath}...`);
        if (!fs.existsSync(localPath)) {
            console.error("data.json not found!");
            process.exit(1);
        }
        dataJson = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }

    let modified = false;

    for (const [code, info] of Object.entries(NCERT_TEXTBOOK_CHAPTERS)) {
        let foundBook = false;
        let matchedCategory = null;
        let matchedSubject = null;
        let matchedBook: any = null;

        // Search through all categories (keys 1-14) in dataJson
        for (const [categoryKey, categoryData] of Object.entries(dataJson)) {
            for (const [subjectName, books] of Object.entries(categoryData as any)) {
                const typedBooks = books as Array<{text: string, code: string, chapters: string}>;
                for (const book of typedBooks) {
                    if (book.code === code) {
                        foundBook = true;
                        matchedCategory = categoryKey;
                        matchedSubject = subjectName;
                        matchedBook = book;
                        // Check if chapter count changed
                        if (book.chapters) {
                            const parts = book.chapters.split('-');
                            const part1 = parts[1];
                            if (parts.length === 2 && part1 !== undefined) {
                                const chapters = parseInt(part1, 10);
                                if (chapters !== info.numChapters) {
                                    console.log(`[Update] Code ${code} chapter count changed from ${info.numChapters} to ${chapters}`);
                                    info.numChapters = chapters;
                                    modified = true;
                                }
                            }
                        }
                        break;
                    }
                }
                if (foundBook) break;
            }
            if (foundBook) break;
        }

        if (!foundBook) {
            console.error(`\n[ERROR] Code '${code}' (Grade ${info.grade} ${info.subject}) is no longer present in data.json!`);
            
            // Try to auto-resolve by looking into dataJson[info.grade.toString()] for a matching subject
            const gradeData = dataJson[info.grade.toString()];
            if (gradeData) {
                const looseSubject = info.subject.replace(/_/g, ' ').toLowerCase();
                let matchingSubjects = Object.keys(gradeData).filter(k => k.toLowerCase().includes(looseSubject) || looseSubject.includes(k.toLowerCase()));
                
                const sub0 = matchingSubjects[0];
                if (matchingSubjects.length === 1 && sub0 !== undefined) {
                    const books = gradeData[sub0] as Array<{text: string, code: string, chapters: string}>;
                    const newBook = books[0];
                    if (books.length === 1 && newBook !== undefined) {
                        console.log(`[Auto-Fix] Found exactly 1 book '${newBook.text}' (${newBook.code}) for subject '${sub0}'. Swapping code!`);
                        
                        const regex = new RegExp(`"${code}":\\s*{([^}]+)}`, 'g');
                        let newNum = info.numChapters;
                        if (newBook.chapters) {
                            const parts = newBook.chapters.split('-');
                            const part1 = parts[1];
                            if (parts.length === 2 && part1 !== undefined) newNum = parseInt(part1, 10);
                        }
                        
                        pipelineContent = pipelineContent.replace(regex, (match, p1) => {
                            return `"${newBook.code}": {${p1.replace(/numChapters:\s*\d+/, `numChapters: ${newNum}`)}}`;
                        });
                        modified = true;
                        continue;
                    } else {
                        console.error(`[Manual Action Required] Subject '${sub0}' has ${books.length} books. Cannot automatically resolve which one replaced '${code}'.`);
                    }
                } else {
                    console.error(`[Manual Action Required] Could not confidently find a matching subject for '${info.subject}' to auto-resolve.`);
                }
            } else {
                console.error(`[Manual Action Required] Grade ${info.grade} not found in data.json.`);
            }
            process.exit(1);
        }
    }

    if (modified) {
        fs.writeFileSync(pipelinePath, pipelineContent, 'utf8');
        console.log("pipeline.ts was updated successfully.");
    } else {
        console.log("All codes are up-to-date. No changes made.");
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
