import { DatabaseManager } from './db.js';
async function main() {
    const dbPath = process.env['SQLITE_DB_PATH'] || 'law_ai_dev.sqlite';
    const db = new DatabaseManager(dbPath);
    db.seedDefaultData();
    const res = db.seedPresentationMockData(true);
    console.log('Seed Law.AI concluído com sucesso:', res);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
