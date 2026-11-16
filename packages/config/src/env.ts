// Side-effect import: load the local .env before anything reads process.env.
// Import it first in every command: import "@applypilot/config/env";
import { applyLocalEnv } from "./index.ts";

applyLocalEnv();
