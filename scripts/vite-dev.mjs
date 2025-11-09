process.env.VITE_CJS_IGNORE_WARNING ??= '1';

import { createServer } from 'vite';

const server = await createServer();

await server.listen();
server.printUrls();

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

