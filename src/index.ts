import { loadConfig } from './config.js';
import { loadEnvFiles } from './env.js';
import { buildApp } from './server.js';

loadEnvFiles();
const config = loadConfig();
const app = buildApp({ config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
