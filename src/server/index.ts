import { createApp } from "./app.js";
import { getEnv } from "./env.js";

const env = getEnv();
const app = await createApp({ env });

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`Homelab Dashboard listening on http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  console.error(error);
  process.exit(1);
}
