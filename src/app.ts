import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { D1Database } from '@cloudflare/workers-types';
import { listBooks, getChapterMetadata, listTopics, getChapter, getCurriculumMap } from './tools/filesystem';
import { searchChapters, searchContent } from './tools/search';
import { streamExplanation, streamQuestion } from './tools/generation';
import { generateQuestionPaper, EXAM_TEMPLATES } from './tools/question_paper';
import { getPrerequisites, getLearningPath } from './tools/graph';

export function createApp(localDb?: D1Database, localEnv?: any) {
  const app = new OpenAPIHono();

  // Helper to resolve the correct database and env context dynamically
  function getContext(c: any) {
    const database = c.env?.DB || localDb;
    const environment = c.env?.DB ? c.env : localEnv;
    return { database, environment };
  }

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      version: '1.0.0',
      title: 'CBSE Ed-Tech Content API',
      description: 'NCERT-grounded content platform: search, explain, generate questions, question papers, and curriculum graphs.'
    },
    servers: [
      {
        url: "https://ncert.getmaterio.app",
        description: "Production"
      }
    ]
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

  // ── Textbook routes ─────────────────────────────────────────────────────────

  const listBooksRoute = createRoute({
    method: 'get',
    path: '/books',
    operationId: 'listBooks',
    tags: ['Books'],
    request: {
      query: z.object({
        grade: z.coerce.number().optional(),
        subject: z.string().optional()
      })
    },
    responses: { 200: { description: 'List of books', content: { 'application/json': { schema: z.array(z.any()) } } } }
  });

  app.openapi(listBooksRoute, async (c) => {
    const { grade, subject } = c.req.valid('query');
    const { database } = getContext(c);
    return c.json(await listBooks(database, grade, subject));
  });

  const listTopicsRoute = createRoute({
    method: 'get',
    path: '/books/{grade}/{subject}/topics',
    operationId: 'listTopics',
    tags: ['Books'],
    request: {
      params: z.object({
        grade: z.coerce.number().openapi({
          param: {
            name: 'grade',
            in: 'path',
            required: true
          }
        }),
        subject: z.string().openapi({
          param: {
            name: 'subject',
            in: 'path',
            required: true
          }
        })
      })
    },
    responses: { 200: { description: 'Chapter list', content: { 'application/json': { schema: z.array(z.any()) } } } }
  });

  app.openapi(listTopicsRoute, async (c) => {
    const { grade, subject } = c.req.valid('param');
    const { database } = getContext(c);
    return c.json(await listTopics(database, grade, subject));
  });

  const getChapterRoute = createRoute({
    method: 'get',
    path: '/books/{grade}/{subject}/chapters/{chapter}',
    operationId: 'getChapter',
    tags: ['Books'],
    request: {
      params: z.object({
        grade: z.coerce.number().openapi({
          param: {
            name: 'grade',
            in: 'path',
            required: true
          }
        }),
        subject: z.string().openapi({
          param: {
            name: 'subject',
            in: 'path',
            required: true
          }
        }),
        chapter: z.coerce.number().openapi({
          param: {
            name: 'chapter',
            in: 'path',
            required: true
          }
        })
      })
    },
    responses: { 200: { description: 'Full chapter text', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(getChapterRoute, async (c) => {
    const { grade, subject, chapter } = c.req.valid('param');
    const { database } = getContext(c);
    return c.json(await getChapter(database, grade, subject, chapter));
  });

  const chapterMetadataRoute = createRoute({
    method: 'get',
    path: '/books/{grade}/{subject}/chapters/{chapter}/metadata',
    operationId: 'getChapterMetadata',
    tags: ['Books'],
    request: {
      params: z.object({
        grade: z.coerce.number().openapi({
          param: {
            name: 'grade',
            in: 'path',
            required: true
          }
        }),
        subject: z.string().openapi({
          param: {
            name: 'subject',
            in: 'path',
            required: true
          }
        }),
        chapter: z.coerce.number().openapi({
          param: {
            name: 'chapter',
            in: 'path',
            required: true
          }
        })
      })
    },
    responses: { 200: { description: 'Chapter metadata', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(chapterMetadataRoute, async (c) => {
    const { grade, subject, chapter } = c.req.valid('param');
    const { database } = getContext(c);
    return c.json(await getChapterMetadata(database, grade, subject, chapter));
  });

  // ── Search routes ───────────────────────────────────────────────────────────

  const searchContentRoute = createRoute({
    method: 'get',
    path: '/search/content',
    operationId: 'searchContent',
    tags: ['Search'],
    request: {
      query: z.object({
        query: z.string(),
        grade: z.coerce.number().optional(),
        subject: z.string().optional(),
        bloom_level: z.string().optional(),
        top_k: z.coerce.number().default(8)
      })
    },
    responses: { 200: { description: 'Search results with highlight, actions, topic, bloom_level per result', content: { 'application/json': { schema: z.array(z.any()) } } } }
  });

  app.openapi(searchContentRoute, async (c) => {
    const { query, grade, subject, bloom_level, top_k } = c.req.valid('query');
    const { database } = getContext(c);
    return c.json(await searchContent(database, query, grade, subject, bloom_level, top_k));
  });

  const searchChaptersRoute = createRoute({
    method: 'get',
    path: '/search/chapters',
    operationId: 'searchChapters',
    tags: ['Search'],
    request: {
      query: z.object({
        query: z.string(),
        grade: z.coerce.number().optional(),
        subject: z.string().optional(),
        top_k: z.coerce.number().default(5)
      })
    },
    responses: { 200: { description: 'BM25 chapter search results', content: { 'application/json': { schema: z.array(z.any()) } } } }
  });

  app.openapi(searchChaptersRoute, async (c) => {
    const { query, grade, subject, top_k } = c.req.valid('query');
    const { database } = getContext(c);
    return c.json(await searchChapters(database, query, grade, subject, top_k));
  });

  // ── Curriculum map route ────────────────────────────────────────────────────

  const curriculumMapRoute = createRoute({
    method: 'get',
    path: '/curriculum/{grade}/{subject}',
    operationId: 'getCurriculumMap',
    tags: ['Curriculum'],
    request: {
      params: z.object({
        grade: z.coerce.number().openapi({
          param: {
            name: 'grade',
            in: 'path',
            required: true
          }
        }),
        subject: z.string().openapi({
          param: {
            name: 'subject',
            in: 'path',
            required: true
          }
        })
      })
    },
    responses: { 200: { description: 'Topics + Bloom\'s distribution per chapter', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(curriculumMapRoute, async (c) => {
    const { grade, subject } = c.req.valid('param');
    const { database } = getContext(c);
    return c.json(await getCurriculumMap(database, grade, subject));
  });

  // ── RAG Generation routes ───────────────────────────────────────────────────

  const explainRoute = createRoute({
    method: 'post',
    path: '/explain',
    operationId: 'generateExplanation',
    tags: ['Generation'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              grade: z.number().int().min(1).max(12),
              subject: z.string(),
              topic: z.string(),
              language: z.enum(["en", "hi"]).optional()
            })
          }
        }
      }
    },
    responses: { 200: { description: 'Streamed explanation (text/event-stream)', content: { 'text/event-stream': { schema: z.any() } } } }
  });

  app.openapi(explainRoute, async (c) => {
    const body = c.req.valid('json');
    const { environment } = getContext(c);
    return new Response(new ReadableStream({
      async start(controller) {
        for await (const [text, meta] of streamExplanation(environment, body.grade, body.subject, body.topic, body.language)) {
          if (meta === null) {
            controller.enqueue(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          } else {
            controller.enqueue(`data: ${JSON.stringify({ type: 'done', ...(meta as object) })}\n\n`);
          }
        }
        controller.close();
      }
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });

  const questionRoute = createRoute({
    method: 'post',
    path: '/question',
    operationId: 'generateQuestion',
    tags: ['Generation'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              grade: z.number().int().min(1).max(12),
              subject: z.string(),
              topic: z.string(),
              bloom_level: z.string().optional(),
              difficulty: z.string().optional(),
              question_type: z.string().optional(),
              marks: z.number().optional()
            })
          }
        }
      }
    },
    responses: { 200: { description: 'Streamed question data', content: { 'text/event-stream': { schema: z.any() } } } }
  });

  app.openapi(questionRoute, async (c) => {
    const body = c.req.valid('json');
    const { environment } = getContext(c);
    return new Response(new ReadableStream({
      async start(controller) {
        for await (const [text, meta] of streamQuestion(environment, body.grade, body.subject, body.topic, body.bloom_level, body.difficulty, body.question_type, body.marks)) {
          if (meta === null) {
            controller.enqueue(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          } else {
            controller.enqueue(`data: ${JSON.stringify({ type: 'done', ...(meta as object) })}\n\n`);
          }
        }
        controller.close();
      }
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });

  // ── Question Paper routes ───────────────────────────────────────────────────

  const examTypesRoute = createRoute({
    method: 'get',
    path: '/exam-types',
    operationId: 'listExamTypes',
    tags: ['Question Papers'],
    request: {},
    responses: { 200: { description: 'Supported exam templates', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(examTypesRoute, (c) => c.json(EXAM_TEMPLATES));

  const questionPaperRoute = createRoute({
    method: 'post',
    path: '/question-paper',
    operationId: 'generateQuestionPaper',
    tags: ['Question Papers'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              grade: z.number().int().min(1).max(12),
              subject: z.string(),
              exam_type: z.string(),
              chapters: z.array(z.number().int()).optional(),
              difficulty_mix: z.any().optional(),
              include_answer_key: z.boolean().optional()
            })
          }
        }
      }
    },
    responses: { 200: { description: 'Generated question paper structure', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(questionPaperRoute, async (c) => {
    const body = c.req.valid('json');
    const { environment } = getContext(c);
    const result = await generateQuestionPaper(environment, body.grade, body.subject, body.exam_type, body.chapters, body.difficulty_mix, body.include_answer_key);
    return c.json(result);
  });

  // ── Curriculum Graph routes ─────────────────────────────────────────────────

  const prerequisitesRoute = createRoute({
    method: 'get',
    path: '/graph/prerequisites',
    operationId: 'getPrerequisites',
    tags: ['Curriculum Graph'],
    request: {
      query: z.object({
        topic: z.string(),
        grade: z.coerce.number(),
        subject: z.string()
      })
    },
    responses: { 200: { description: 'Prerequisite topics', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(prerequisitesRoute, async (c) => {
    const { topic, grade, subject } = c.req.valid('query');
    const { database } = getContext(c);
    return c.json(await getPrerequisites(database, topic, grade, subject));
  });

  const learningPathRoute = createRoute({
    method: 'get',
    path: '/graph/learning-path',
    operationId: 'getLearningPath',
    tags: ['Curriculum Graph'],
    request: {
      query: z.object({
        topic: z.string(),
        grade: z.coerce.number(),
        subject: z.string()
      })
    },
    responses: { 200: { description: 'Full ordered learning path', content: { 'application/json': { schema: z.any() } } } }
  });

  app.openapi(learningPathRoute, async (c) => {
    const { topic, grade, subject } = c.req.valid('query');
    const { database } = getContext(c);
    return c.json(await getLearningPath(database, topic, grade, subject));
  });

  return app;
}
