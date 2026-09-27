import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20000,
    // DB test files share one real Postgres/GoTrue instance (and each calls deleteTestUsers() in
    // beforeAll), so running files in parallel lets one file's cleanup delete another's live users.
    fileParallelism: false,
  },
});
