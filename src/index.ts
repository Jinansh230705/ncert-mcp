import { handle } from 'hono/vercel';
import { getLocalDb } from './db-local';
import { createApp } from './app';
import dotenv from 'dotenv';

dotenv.config();

const db = getLocalDb();
const env = {
    DB: db,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    MODEL_NAME: process.env.MODEL_NAME
};

const app = createApp(db, env);

export default {
    port: process.env.PORT || 8000,
    fetch: app.fetch
};

export { app };
export const GET = handle(app);
export const POST = handle(app);
