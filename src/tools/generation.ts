import OpenAI from 'openai';
import { searchContent } from './search';
import type { Env } from '../db';

export async function* streamExplanation(env: Env, grade: number, subject: string, topic: string, language: string = "en") {
    const ai = new OpenAI({
        baseURL: env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: env.OPENAI_API_KEY || "dummy",
    });
    const MODEL = env.MODEL_NAME || 'google/gemini-2.5-pro';

    const searchResults = await searchContent(env.DB, topic, grade, subject, undefined, 8);
    const contextText = searchResults.map((r: any) => `[${r.source_file} (Chunk ${r.chunk_index})]: ${r.text}`).join("\n\n");
    const sourceChunks = searchResults.map((r: any) => `${r.source_file}[${r.chunk_index}]`);

    const stage = grade <= 5 ? "Foundational" : grade <= 8 ? "Middle" : grade <= 10 ? "Secondary" : "Higher Secondary";
    const toneInstruction = 
        stage === "Foundational" ? "Use very simple language, real-life examples from everyday Indian life, and short sentences. Avoid jargon." :
        stage === "Middle" ? "Use activity-based explanations with Indian daily-life examples. Keep language accessible and engaging." :
        stage === "Secondary" ? "Use formal language, NCERT-style structure, and exam-pattern awareness. Include typical board exam patterns." :
        "Use analytical depth. Include derivations where relevant. Align with JEE/NEET standards where applicable.";

    const prompt = `\
You are an expert CBSE/NCERT teacher for Grade ${grade} ${subject} (NCF 2023 Stage: ${stage}).
Explain the topic: "${topic}" in ${language === "hi" ? "Hindi" : "English"}.
Use the provided NCERT textbook excerpts as your primary source of truth.

Tone guidance: ${toneInstruction}

NCERT Excerpts:
${contextText}

Structure the explanation clearly using Markdown:
## Definition / Introduction
## Key Concepts
## Examples / Applications
## Summary

Include a Mermaid diagram in \`\`\`mermaid if the topic involves a process, cycle, hierarchy, or flowchart.
`;

    const responseStream = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: true
    });

    for await (const chunk of responseStream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
            yield [text, null];
        }
    }

    yield ["", {
        source_chunks: sourceChunks,
        model_used: MODEL,
        stage,
        mermaid_diagram: null
    }];
}

export async function* streamQuestion(
    env: Env,
    grade: number,
    subject: string,
    topic: string,
    bloomLevel: string = "understand",
    difficulty: string = "medium",
    questionType: string = "MCQ",
    marks: number = 1
) {
    const ai = new OpenAI({
        baseURL: env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: env.OPENAI_API_KEY || "dummy",
    });
    const MODEL = env.MODEL_NAME || 'google/gemini-2.5-pro';

    const searchResults = await searchContent(env.DB, topic, grade, subject, bloomLevel, 8);
    const contextText = searchResults.map((r: any) => `[${r.source_file}]: ${r.text}`).join("\n\n");

    const prompt = `
Generate a CBSE-style ${questionType} question for Grade ${grade} ${subject} on "${topic}".
Bloom's Level: ${bloomLevel}, Difficulty: ${difficulty}, Marks: ${marks}.
Use the following NCERT text to ground your question:
${contextText}

Output valid JSON ONLY matching this schema:
{
  "question": "string",
  "answer": "string",
  "marking_scheme": ["step 1", "step 2"],
  "distractors": ["wrong 1", "wrong 2", "wrong 3"]
}
`;

    const responseStream = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        stream: true
    });

    let fullText = "";
    for await (const chunk of responseStream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
            fullText += text;
            yield [text, null];
        }
    }

    try {
        const parsed = JSON.parse(fullText);
        yield ["", { ...parsed, model_used: MODEL }];
    } catch (e) {
        yield ["", { error: "Failed to parse JSON", raw: fullText }];
    }
}
