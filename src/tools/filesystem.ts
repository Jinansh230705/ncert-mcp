export async function listBooks(db: D1Database, grade?: number, subject?: string) {
    let sql = `
        SELECT 
            c.book_code, c.grade, c.subject, 
            COUNT(DISTINCT c.chapter) as chapters_count, 
            MAX(i.book_title) as book_title
        FROM (
            SELECT substr(source_file, 1, 5) as book_code, grade, subject, chapter 
            FROM content_chunks
        ) c
        LEFT JOIN content_items i ON c.book_code = i.book_code AND c.chapter = i.chapter_num
    `;
    const conditions: string[] = [];
    const params: any[] = [];

    if (grade !== undefined && grade !== null) {
        conditions.push("c.grade = ?");
        params.push(grade);
    }
    if (subject) {
        conditions.push("LOWER(c.subject) = LOWER(?)");
        params.push(subject);
    }

    if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` GROUP BY c.book_code, c.grade, c.subject ORDER BY c.grade, c.subject`;

    try {
        const { results } = await db.prepare(sql).bind(...params).all();
        return (results || []).map((r: any) => ({
            grade: r.grade,
            subject: r.subject,
            book_code: r.book_code,
            book_title: r.book_title || r.book_code,
            chapters_in_database: r.chapters_count
        }));
    } catch (e: any) {
        console.error("List Books Error:", e.message);
        return [];
    }
}

export async function getChapterMetadata(db: D1Database, grade: number, subject: string, chapter: number) {
    // Derive metadata dynamically from database contents rather than reading local meta files
    const sql = `
        SELECT DISTINCT substr(source_file, 1, 5) as book_code, source_file
        FROM content_chunks
        WHERE grade = ? AND LOWER(subject) = LOWER(?) AND chapter = ?
        LIMIT 1
    `;
    try {
        const row = await db.prepare(sql).bind(grade, subject, chapter).first() as any;
        if (!row) throw new Error("Metadata not found in database");
        return {
            grade,
            subject,
            book_code: row.book_code,
            chapter,
            source: "NCERT_nic_in_pdf",
            url: `https://ncert.nic.in/textbook/pdf/${row.source_file}`,
            local_file: row.source_file
        };
    } catch (e: any) {
        return {
            grade,
            subject,
            chapter,
            error: `Failed to get chapter metadata: ${e.message}`
        };
    }
}

export async function listTopics(db: D1Database, grade: number, subject: string) {
    try {
        const rows = await db.prepare(`
            SELECT * FROM content_items
            WHERE grade = ? AND LOWER(subject) = LOWER(?)
            ORDER BY chapter_num
        `).bind(grade, subject).all() as any;

        if (rows.results && rows.results.length > 0) {
            return rows.results.map((r: any) => ({
                chapter: r.chapter_num,
                chapter_title: r.title,
                book_title: r.book_title || undefined,
                on_disk: true
            }));
        }

        // Fallback: Query unique chapters in content_chunks directly
        const chunkRows = await db.prepare(`
            SELECT DISTINCT chapter FROM content_chunks
            WHERE grade = ? AND LOWER(subject) = LOWER(?)
            ORDER BY chapter
        `).bind(grade, subject).all() as any;

        return (chunkRows.results || []).map((r: any) => ({
            chapter: r.chapter,
            chapter_title: `Chapter ${r.chapter}`,
            on_disk: true
        }));
    } catch (e: any) {
        console.error("List Topics Error:", e.message);
        return [];
    }
}

export async function getChapter(db: D1Database, grade: number, subject: string, chapter: number) {
    // Reconstruct full chapter text by concatenating its database chunks
    const sql = `
        SELECT text FROM content_chunks
        WHERE grade = ? AND LOWER(subject) = LOWER(?) AND chapter = ?
        ORDER BY chunk_index
    `;
    try {
        const { results } = await db.prepare(sql).bind(grade, subject, chapter).all();
        if (!results || results.length === 0) {
            return {
                grade,
                subject,
                chapter,
                text: `Chapter ${chapter} text not found in database.`,
                source: 'not_found'
            };
        }

        const fullText = results.map((r: any) => r.text).join("\n\n");
        return {
            grade,
            subject,
            chapter,
            text: fullText,
            source: 'database_reconstructed'
        };
    } catch (e: any) {
        return {
            grade,
            subject,
            chapter,
            text: `Error reconstructing chapter text: ${e.message}`,
            source: 'error'
        };
    }
}

export async function getCurriculumMap(db: D1Database, grade: number, subject: string) {
    const sql = `
        SELECT chapter, topic, bloom_level, difficulty, COUNT(*) as chunk_count
        FROM content_chunks
        WHERE grade = ? AND LOWER(subject) = LOWER(?)
        GROUP BY chapter, topic, bloom_level, difficulty
        ORDER BY chapter, topic
    `;
    try {
        const { results } = await db.prepare(sql).bind(grade, subject).all();
        const chaptersMap = new Map<number, any>();

        for (const row of (results || []) as any[]) {
            if (!chaptersMap.has(row.chapter)) {
                chaptersMap.set(row.chapter, {
                    chapter: row.chapter,
                    topics: [],
                    bloom_distribution: {} as Record<string, number>
                });
            }
            const ch = chaptersMap.get(row.chapter)!;

            if (!ch.topics.find((t: any) => t.topic === row.topic)) {
                ch.topics.push({
                    topic: row.topic,
                    bloom_level: row.bloom_level,
                    difficulty: row.difficulty,
                    chunk_count: row.chunk_count
                });
            }

            ch.bloom_distribution[row.bloom_level] = (ch.bloom_distribution[row.bloom_level] || 0) + row.chunk_count;
        }

        return {
            grade,
            subject,
            chapters: Array.from(chaptersMap.values())
        };
    } catch (e: any) {
        return { error: `Failed to fetch curriculum map: ${e.message}` };
    }
}
