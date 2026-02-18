import { buildApp } from "./app.js";
import { getConfig } from "./shared/env.js";

const config = getConfig();

const app = await buildApp();

await app.listen({ port: config.port, host: config.host });

