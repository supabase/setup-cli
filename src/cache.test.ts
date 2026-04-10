import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as cacheAction from "@actions/cache";
import * as core from "@actions/core";
import {
  collectDockerImageRefs,
  createDockerImageCacheKey,
  restoreDockerImageCache,
  saveDockerImageCache,
} from "./cache";

const originalRunnerTemp = process.env.RUNNER_TEMP;
const originalWorkspace = process.env.GITHUB_WORKSPACE;
const tempDirs = new Set<string>();

afterEach(() => {
  mock.restore();
  process.env.RUNNER_TEMP = originalRunnerTemp;
  process.env.GITHUB_WORKSPACE = originalWorkspace;

  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs.clear();
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

test("creates a docker image cache key from runner, version, registry, and config", () => {
  const workspace = createTempDir("setup-cli-workspace-");
  mkdirSync(path.join(workspace, "supabase"), { recursive: true });
  writeFileSync(path.join(workspace, "supabase", "config.toml"), 'project_id = "test"\n');
  process.env.GITHUB_WORKSPACE = workspace;

  const key = createDockerImageCacheKey("supabase 2.84.2", "ghcr.io");

  expect(key).toStartWith(`supabase-cli-containers-v1-${process.platform}-${process.arch}-`);
  expect(key).toContain("supabase-2.84.2-ghcr.io-");
});

test("collects images from labeled containers and Supabase image repositories", async () => {
  const run = mock(async (_file: string, args: string[]) => {
    if (args[0] === "ps") {
      return {
        stdout: "ghcr.io/supabase/postgres:15.8.1\ncustom/image:latest\n",
        stderr: "",
      };
    }

    return {
      stdout:
        "ghcr.io/supabase/studio:2026.04.08\npublic.ecr.aws/supabase/kong:2.8.1\nlibrary/postgres:16\n<none>:<none>\n",
      stderr: "",
    };
  });

  expect(await collectDockerImageRefs(run)).toEqual([
    "custom/image:latest",
    "ghcr.io/supabase/postgres:15.8.1",
    "ghcr.io/supabase/studio:2026.04.08",
    "public.ecr.aws/supabase/kong:2.8.1",
  ]);
});

test("restore skips docker and cache calls when cache input is disabled", async () => {
  const run = mock(async () => ({ stdout: "", stderr: "" }));
  const restoreCache = spyOn(cacheAction, "restoreCache").mockImplementation(async () => undefined);
  const spies = {
    getBooleanInput: spyOn(core, "getBooleanInput").mockImplementation(() => false),
    getInput: spyOn(core, "getInput").mockImplementation(() => ""),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    saveState: spyOn(core, "saveState").mockImplementation(() => {}),
  };

  await restoreDockerImageCache("supabase 2.84.2", "ghcr.io", run);

  expect(spies.setOutput).toHaveBeenCalledWith("cache-hit", "false");
  expect(spies.saveState).toHaveBeenCalledWith("cache-enabled", "false");
  expect(run).not.toHaveBeenCalled();
  expect(restoreCache).not.toHaveBeenCalled();
});

test("restore loads a docker archive on exact cache hit", async () => {
  const temp = createTempDir("setup-cli-runner-");
  process.env.RUNNER_TEMP = temp;
  const calls: string[][] = [];
  const run = mock(async (_file: string, args: string[]) => {
    calls.push(args);
    return { stdout: "ok\n", stderr: "" };
  });
  const restoreCache = spyOn(cacheAction, "restoreCache").mockImplementation(
    async (paths: string[], key: string) => {
      writeFileSync(paths[0]!, "archive");
      return key;
    },
  );
  const spies = {
    getBooleanInput: spyOn(core, "getBooleanInput").mockImplementation(() => true),
    getInput: spyOn(core, "getInput").mockImplementation((name: string) =>
      name === "cache-key" ? "cache-key" : "",
    ),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    saveState: spyOn(core, "saveState").mockImplementation(() => {}),
    info: spyOn(core, "info").mockImplementation(() => {}),
    warning: spyOn(core, "warning").mockImplementation(() => {}),
  };

  await restoreDockerImageCache("supabase 2.84.2", "ghcr.io", run);

  expect(restoreCache).toHaveBeenCalledWith(
    [path.join(temp, "setup-supabase-cli", "supabase-cli-docker-images.tar")],
    "cache-key",
  );
  expect(spies.setOutput).toHaveBeenCalledWith("cache-hit", "true");
  expect(spies.saveState).toHaveBeenCalledWith("cache-hit", "true");
  expect(calls).toContainEqual([
    "load",
    "-i",
    path.join(temp, "setup-supabase-cli", "supabase-cli-docker-images.tar"),
  ]);
  expect(spies.warning).not.toHaveBeenCalled();
});

test("post saves collected Supabase docker images", async () => {
  const temp = createTempDir("setup-cli-runner-");
  process.env.RUNNER_TEMP = temp;
  const calls: string[][] = [];
  const run = mock(async (_file: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "ps") {
      return { stdout: "ghcr.io/supabase/postgres:15.8.1\n", stderr: "" };
    }
    if (args[0] === "image") {
      return { stdout: "ghcr.io/supabase/studio:2026.04.08\n", stderr: "" };
    }
    return { stdout: "ok\n", stderr: "" };
  });
  const saveCache = spyOn(cacheAction, "saveCache").mockImplementation(async () => 1);
  const state = new Map([
    ["cache-enabled", "true"],
    ["cache-hit", "false"],
    ["cache-primary-key", "cache-key"],
    ["cache-archive-path", path.join(temp, "setup-supabase-cli", "supabase-cli-docker-images.tar")],
  ]);
  spyOn(core, "getState").mockImplementation((name: string) => state.get(name) ?? "");
  spyOn(core, "info").mockImplementation(() => {});
  spyOn(core, "warning").mockImplementation(() => {});

  await saveDockerImageCache(run);

  expect(calls).toContainEqual([
    "save",
    "-o",
    path.join(temp, "setup-supabase-cli", "supabase-cli-docker-images.tar"),
    "ghcr.io/supabase/postgres:15.8.1",
    "ghcr.io/supabase/studio:2026.04.08",
  ]);
  expect(saveCache).toHaveBeenCalledWith(
    [path.join(temp, "setup-supabase-cli", "supabase-cli-docker-images.tar")],
    "cache-key",
  );
});
