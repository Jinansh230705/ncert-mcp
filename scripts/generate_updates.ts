import { Database } from 'bun:sqlite';
import * as fs from 'fs';

const db = new Database('./data/content.db');
const items = db.query('SELECT id, title FROM content_items').all();
let sql = '';
for (const item of items as any[]) {
  const safeTitle = item.title ? item.title.replace(/'/g, "''") : '';
  sql += `UPDATE content_items SET title = '${safeTitle}' WHERE id = ${item.id};\n`;
}
fs.writeFileSync('./data/updates.sql', sql);
console.log(`Generated updates.sql with ${items.length} statements.`);
