export async function getPrerequisites(db: D1Database, topic: string, grade: number, subject: string) {
    const sql = `
        SELECT pre_grade, pre_subject, pre_chapter, pre_topic, rationale, confidence
        FROM curriculum_edges
        WHERE post_topic = ?
          AND post_grade = ?
          AND post_subject = ?
        ORDER BY pre_grade DESC, confidence DESC
    `;
    try {
        const { results } = await db.prepare(sql).bind(topic, grade, subject).all();
        return {
            target: { topic, grade, subject },
            prerequisites: results || []
        };
    } catch (e: any) {
        return {
            target: { topic, grade, subject },
            prerequisites: [],
            error: e.message
        };
    }
}

export async function getLearningPath(db: D1Database, topic: string, grade: number, subject: string) {
    const visited = new Set<string>();
    const queue: Array<{ topic: string; grade: number; subject: string; depth: number }> = [
        { topic, grade, subject, depth: 0 }
    ];
    const nodes: Array<{ step: number; topic: string; grade: number; subject: string; depth: number }> = [];

    try {
        while (queue.length > 0) {
            const current = queue.shift()!;
            const key = `${current.grade}-${current.subject}-${current.topic}`;
            if (visited.has(key)) continue;
            visited.add(key);

            nodes.push({
                step: nodes.length + 1,
                topic: current.topic,
                grade: current.grade,
                subject: current.subject,
                depth: current.depth
            });

            if (current.depth >= 6) continue; // safety cap

            const sql = `
                SELECT pre_grade, pre_subject, pre_topic
                FROM curriculum_edges
                WHERE post_topic = ?
                  AND post_grade = ?
                  AND post_subject = ?
                ORDER BY confidence DESC
            `;
            const { results } = await db.prepare(sql).bind(current.topic, current.grade, current.subject).all();

            for (const p of (results || []) as any[]) {
                const pKey = `${p.pre_grade}-${p.pre_subject}-${p.pre_topic}`;
                if (!visited.has(pKey)) {
                    queue.push({ topic: p.pre_topic, grade: p.pre_grade, subject: p.pre_subject, depth: current.depth + 1 });
                }
            }
        }

        // Reverse so roots (deepest prerequisites) come first
        const path = nodes.slice(1).reverse().concat(nodes[0]!);

        return {
            target: { topic, grade, subject },
            total_steps: path.length,
            path
        };
    } catch (e: any) {
        return {
            target: { topic, grade, subject },
            total_steps: 0,
            path: [],
            error: e.message
        };
    }
}
