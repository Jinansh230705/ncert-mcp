import {Database} from 'bun:sqlite';
const db = new Database('./data/content.db');
db.run("UPDATE content_items SET title = 'Chapter ' || chapter_num");
console.log('Reverted all titles');
