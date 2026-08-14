import type { Env } from '../db';
import { streamQuestion } from './generation';

export const EXAM_TEMPLATES: Record<string, any> = {
    class_test:   { label: "Class Test",   default_marks: 20, default_duration: "40 min",  sections: [{ type: "MCQ", count: 10, marks_each: 1 }, { type: "SAQ", count: 5, marks_each: 2 }] },
    weekly_test:  { label: "Weekly Test",  default_marks: 25, default_duration: "45 min",  sections: [{ type: "MCQ", count: 10, marks_each: 1 }, { type: "SAQ", count: 5, marks_each: 3 }] },
    monthly_test: { label: "Monthly Test", default_marks: 50, default_duration: "90 min",  sections: [{ type: "MCQ", count: 10, marks_each: 1 }, { type: "SAQ", count: 10, marks_each: 2 }, { type: "LAQ", count: 4, marks_each: 5 }] },
    mid_term:     { label: "Mid Term",     default_marks: 80, default_duration: "3 hr",    sections: [{ type: "MCQ", count: 20, marks_each: 1 }, { type: "SAQ", count: 10, marks_each: 2 }, { type: "LAQ", count: 5, marks_each: 4 }, { type: "LAQ", count: 3, marks_each: 6 }] },
    pre_board:    { label: "Pre Board",    default_marks: 80, default_duration: "3 hr",    sections: [{ type: "MCQ", count: 20, marks_each: 1 }, { type: "SAQ", count: 8,  marks_each: 2 }, { type: "SAQ", count: 5, marks_each: 3 }, { type: "LAQ", count: 3, marks_each: 5 }, { type: "LAQ", count: 2, marks_each: 6 }] },
    board:        { label: "Board Exam",   default_marks: 80, default_duration: "3 hr",    sections: [{ type: "MCQ", count: 20, marks_each: 1 }, { type: "SAQ", count: 8,  marks_each: 2 }, { type: "SAQ", count: 5, marks_each: 3 }, { type: "LAQ", count: 3, marks_each: 5 }, { type: "LAQ", count: 2, marks_each: 6 }] },
};

const BLOOM_SEQUENCE = ["remember", "understand", "apply", "analyse", "evaluate", "create"];

function pickBloomLevel(sectionIndex: number, totalSections: number): string {
    const idx = Math.round((sectionIndex / totalSections) * (BLOOM_SEQUENCE.length - 1));
    return BLOOM_SEQUENCE[idx] || "understand";
}

async function fetchOrGenerateQuestion(
    env: Env,
    grade: number,
    subject: string,
    chapters: number[] | undefined,
    questionType: string,
    bloomLevel: string,
    marks: number,
    usedIds: Set<number>
): Promise<any> {
    const db = env.DB;
    const chaptersClause = chapters && chapters.length > 0
        ? `AND chapter IN (${chapters.map(() => '?').join(',')})`
        : '';
    
    const params: any[] = [grade, subject, questionType, bloomLevel, marks];
    if (chapters) {
        params.push(...chapters);
    }

    const sql = `
        SELECT * FROM question_bank
        WHERE grade = ? AND subject = ?
          AND question_type = ?
          AND bloom_level = ?
          AND marks = ?
          ${chaptersClause}
        ORDER BY times_used ASC
        LIMIT 1
    `;

    try {
        const existing = await db.prepare(sql).bind(...params).first() as any;

        if (existing && !usedIds.has(existing.id)) {
            usedIds.add(existing.id);
            await db.prepare(`UPDATE question_bank SET times_used = times_used + 1 WHERE id = ?`).bind(existing.id).run();
            return {
                question: existing.question,
                type: questionType,
                marks,
                bloom_level: bloomLevel,
                answer: existing.answer,
                marking_scheme: existing.marking_scheme ? JSON.parse(existing.marking_scheme) : [],
                distractors: existing.distractors ? JSON.parse(existing.distractors) : [],
                source: 'question_bank'
            };
        }
    } catch (e: any) {
        console.error("QB fetch error:", e.message);
    }

    // 2. Generate fresh via LLM
    const topic = `Grade ${grade} ${subject}` + (chapters ? ` Chapter ${chapters[0]}` : '');
    let metadata: any = null;
    for await (const [, meta] of streamQuestion(env, grade, subject, topic, bloomLevel, "medium", questionType, marks)) {
        if (meta !== null) metadata = meta;
    }

    if (metadata && !metadata.error) {
        try {
            const result = await db.prepare(`
                INSERT INTO question_bank
                (grade, subject, chapter, topic, question_type, bloom_level, difficulty, marks, question, answer, marking_scheme, distractors)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                grade, subject, chapters?.[0] ?? null, topic,
                questionType, bloomLevel, "medium", marks,
                metadata.question, metadata.answer,
                JSON.stringify(metadata.marking_scheme ?? []),
                JSON.stringify(metadata.distractors ?? [])
            ).run();
            if (result.meta.last_row_id) usedIds.add(result.meta.last_row_id as number);
        } catch (e: any) {
            console.warn("QB insert failed:", e.message);
        }
    }

    return { ...(metadata ?? { question: "Generation failed", answer: "" }), type: questionType, marks, bloom_level: bloomLevel, source: 'generated' };
}

export async function generateQuestionPaper(
    env: Env,
    grade: number,
    subject: string,
    examType: string,
    chapters?: number[],
    difficultyMix?: any,
    includeAnswerKey: boolean = true
) {
    if (!EXAM_TEMPLATES[examType]) return { error: `Unknown exam type: ${examType}` };

    const template = EXAM_TEMPLATES[examType];
    const usedIds = new Set<number>();
    const sections: any[] = [];

    for (let si = 0; si < template.sections.length; si++) {
        const sec = template.sections[si];
        const bloomLevel = pickBloomLevel(si, template.sections.length);
        const questions: any[] = [];

        for (let qi = 0; qi < sec.count; qi++) {
            const q = await fetchOrGenerateQuestion(env, grade, subject, chapters, sec.type, bloomLevel, sec.marks_each, usedIds);
            questions.push(q);
        }

        sections.push({
            name: `Section ${String.fromCharCode(65 + si)} — ${sec.type} (${sec.marks_each} mark${sec.marks_each > 1 ? 's' : ''} each)`,
            type: sec.type,
            bloom_level: bloomLevel,
            questions: includeAnswerKey ? questions : questions.map(({ answer: _a, marking_scheme: _ms, ...rest }) => rest)
        });
    }

    return {
        title: `CBSE ${template.label} — Grade ${grade} ${subject}`,
        duration: template.default_duration,
        total_marks: template.default_marks,
        chapters_covered: chapters ?? "all",
        instructions: [
            "All questions are compulsory.",
            "Read each question carefully before answering.",
            `Total time allowed: ${template.default_duration}.`
        ],
        sections,
        ...(includeAnswerKey ? { answer_key_included: true } : {})
    };
}
