import { judgeSubmissionRequestSchema } from "@leetcollab/contracts";
import { NextResponse } from "next/server";
import { authenticateBearer } from "../../../../lib/server/authenticate";
import { getJudgeService } from "../../../../lib/server/judge/context";
import { getSupabaseAdmin } from "../../../../lib/server/supabase-admin";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const admin = getSupabaseAdmin();
  const userId = await authenticateBearer(request, async (token) => {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  });
  if (!userId) {
    return json({ error: { code: "UNAUTHENTICATED", message: "A valid Supabase session is required." } }, 401);
  }

  const problemId = new URL(request.url).searchParams.get("problemId");
  const parsed = judgeSubmissionRequestSchema.shape.problemId.safeParse(problemId);
  if (!parsed.success) {
    return json({ error: { code: "INVALID_REQUEST", message: "problemId must be a UUID." } }, 400);
  }

  try {
    const result = await getJudgeService().status(parsed.data);
    return json(result.body, result.status);
  } catch {
    return json({ error: { code: "JUDGE_UNAVAILABLE", message: "Judge status is temporarily unavailable." } }, 503);
  }
}
