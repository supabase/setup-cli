import * as core from "@actions/core";
import { fileURLToPath } from "node:url";
import { saveDockerImageCache } from "./cache";

export async function run(): Promise<void> {
  try {
    await saveDockerImageCache();
  } catch (error) {
    core.warning(
      `Supabase Docker image cache post step failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
