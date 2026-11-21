import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const production = "https://leetcollab.vercel.app";
const staging = "https://leetcollab-staging.vercel.app";
const unlisted = "https://leetcollab.vercel.app.example.test";

for (const origins of [[staging, production], [staging]]) {
  test(`serves credentialed CORS for exactly ${origins.join(", ")}`, { timeout: 15_000 }, async () => {
    const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        CORS_ORIGIN: origins.join(", "),
        NODE_ENV: "production",
        ROOM_RESTORE_FILE: "unused-snapshot.json",
        SUPABASE_URL: "http://127.0.0.1:1",
        SUPABASE_ANON_KEY: "synthetic",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      const base = await new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.once("exit", code => reject(new Error(`Realtime exited with status ${code}`)));
        let output = "";
        server.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          output += chunk;
          const address = /Realtime server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
          if (address) resolve(address[1]);
        });
      });
      for (const path of ["/health", "/socket.io/?EIO=4&transport=polling"]) {
        for (const origin of [production, staging, unlisted]) {
          const response = await fetch(base + path, { headers: { Origin: origin }, signal: AbortSignal.timeout(5_000) });
          assert.equal(response.status, 200);
          const body = await response.text();
          if (path === "/health") assert.deepEqual(JSON.parse(body), { ok: true });
          else assert.match(body, /^0\{"sid":"[^"]+"/);
          assert.equal(response.headers.get("access-control-allow-origin"), origins.includes(origin) ? origin : null);
          if (origins.includes(origin)) {
            assert.equal(response.headers.get("access-control-allow-credentials"), "true");
            assert.match(response.headers.get("vary") ?? "", /\bOrigin\b/i);
          }
        }
      }
    } finally {
      if (server.exitCode === null && server.signalCode === null) {
        const closed = once(server, "close");
        server.kill();
        await closed;
      }
    }
  });
}
