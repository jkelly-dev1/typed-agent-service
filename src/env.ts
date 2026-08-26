/**
 * Environment file loading, using Node's built-in process.loadEnvFile
 * (Node >= 20.12, no dotenv dependency). Two sources, in order:
 *
 *   1. ENV_FILE=<path>  an explicit file, typically a private secrets file
 *      OUTSIDE the repo (e.g. ~/.secrets/ai.env, chmod 600) shared by every
 *      demo. A missing explicit file is an error, not a silent fallback.
 *   2. ./.env           local repo file if present (gitignored).
 *
 * Values already present in the process environment win over file values, so
 * `AGENT_PROVIDER=openai npm run demo` overrides whatever the file says.
 * Keys stay in the file; commands and transcripts only ever contain the path.
 */
export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env): void {
  const explicit = env.ENV_FILE;
  if (explicit) {
    process.loadEnvFile(explicit);
    return;
  }
  try {
    process.loadEnvFile('.env');
  } catch {
    // No local .env: fine, the mock provider needs no credentials.
  }
}
