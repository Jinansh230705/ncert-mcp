import { sanitizeFtsQuery } from '../db';

export async function searchContent(
    db: D1Database,
    query: string,
    grade?: number,
    subject?: string,
    bloomLevel?: string,
    topK: number = 8
) {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    const conditions: string[] = ["content_chunks_fts MATCH ?"];
    const params: any[] = [ftsQuery];

    if (grade !== undefined && grade !== null) {
        conditions.push("grade = ?");
        params.push(grade);
    }
    if (subject) {
        conditions.push("LOWER(subject) = LOWER(?)");
        params.push(subject);
    }
    if (bloomLevel) {
        conditions.push("bloom_level = ?");
        params.push(bloomLevel);
    }

    params.push(topK);

    const sql = `
        SELECT source_file, grade, subject, chapter, chunk_index, bloom_level, topic, difficulty, text,
               bm25(content_chunks_fts) as score
        FROM content_chunks_fts
        WHERE ${conditions.join(" AND ")}
        ORDER BY score ASC
        LIMIT ?
    `;

    try {
        const { results } = await db.prepare(sql).bind(...params).all();
        
        return (results || []).map((r: any) => ({
            score: -r.score, // Negated score so higher is better
            grade: r.grade,
            subject: r.subject,
            chapter: r.chapter,
            topic: r.topic,
            bloom_level: r.bloom_level,
            difficulty: r.difficulty,
            highlight: `Grade ${r.grade} ${r.subject} · Chapter ${r.chapter} · Topic: ${r.topic || 'General'} · ${r.bloom_level} · ${r.difficulty}`,
            actions: {
                explain: { grade: r.grade, subject: r.subject, topic: r.topic },
                question: { grade: r.grade, subject: r.subject, topic: r.topic, bloom_level: r.bloom_level, difficulty: r.difficulty },
                learning_path: { grade: r.grade, subject: r.subject, topic: r.topic }
            },
            text: r.text,
            source_file: r.source_file,
            chunk_index: r.chunk_index
        }));
    } catch (e: any) {
        console.error("FTS Search Error:", e.message);
        return [];
    }
}

export async function searchChapters(
    db: D1Database,
    query: string,
    grade?: number,
    subject?: string,
    topK: number = 5
) {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    const conditions: string[] = ["content_chunks_fts MATCH ?"];
    const params: any[] = [ftsQuery];

    if (grade !== undefined && grade !== null) {
        conditions.push("grade = ?");
        params.push(grade);
    }
    if (subject) {
        conditions.push("LOWER(subject) = LOWER(?)");
        params.push(subject);
    }

    const sql = `
        SELECT grade, subject, chapter, text, bm25(content_chunks_fts) as score
        FROM content_chunks_fts
        WHERE ${conditions.join(" AND ")}
        ORDER BY score ASC
    `;

    try {
        const { results } = await db.prepare(sql).bind(...params).all();
        const chaptersMap = new Map<string, any>();

        for (const r of (results || []) as any[]) {
            const key = `${r.grade}-${r.subject}-${r.chapter}`;
            if (!chaptersMap.has(key)) {
                chaptersMap.set(key, {
                    grade: r.grade,
                    subject: r.subject,
                    chapter: r.chapter,
                    score: -r.score,
                    snippet: r.text.substring(0, 300) + "..."
                });
            }
        }

        return Array.from(chaptersMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    } catch (e: any) {
        console.error("FTS Chapter Search Error:", e.message);
        return [];
    }
}
