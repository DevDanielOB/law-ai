import 'dotenv/config';
import { createApp } from './api/app.js';
const PORT = parseInt(process.env['PORT'] || '8000', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
async function bootstrap() {
    const app = createApp({
        dbPath: process.env['SQLITE_DB_PATH'] || ':memory:',
        seed: true,
    });
    try {
        await app.listen({ port: PORT, host: HOST });
        console.log(`========================================================`);
        console.log(`  Law.AI Platform running on http://${HOST}:${PORT}/`);
        console.log(`  TypeScript 5 Strict Mode • Node.js ${process.version}`);
        console.log(`  Advogado Titular: Dr. Fabricio Cardoso Gomes (OAB/GO 41.209)`);
        console.log(`  Escritório: Cardoso & Associados Advocacia (OAB/GO 4.512)`);
        console.log(`========================================================`);
    }
    catch (err) {
        console.error('Falha ao iniciar o servidor Law.AI:', err);
        process.exit(1);
    }
}
bootstrap();
