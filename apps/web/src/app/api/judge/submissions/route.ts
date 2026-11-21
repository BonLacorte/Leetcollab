import { judgeSubmissionRequestSchema } from "@leetcollab/contracts";
import { NextResponse } from "next/server";
import { authenticateBearer, bearerToken } from "../../../../lib/server/authenticate";
import { RoomParticipationUnavailable } from "../../../../lib/server/judge/room-participants";
import { readSubmissionJson } from "../../../../lib/server/judge/request-body";
import { getJudgeService } from "../../../../lib/server/judge/context";
import { getSupabaseAdmin } from "../../../../lib/server/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();
  const userId = await authenticateBearer(request, async (token) => {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  });
  if (!userId) {
    return json({ ok: false, error: { code: "UNAUTHENTICATED", message: "A valid Supabase session is required." } }, 401);
  }

  let payload: unknown;
  try {
    payload = await readSubmissionJson(request);
  } catch {
    return json({ ok: false, error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } }, 400);
  }
  const parsed = judgeSubmissionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ ok: false, error: { code: "INVALID_REQUEST", message: "Submission fields are invalid." } }, 400);
  }

  try {
    const result = await getJudgeService(userId, parsed.data.problemId, bearerToken(request)!).submit(userId, parsed.data);
    return json(result.body, result.status);
  } catch (error) {
    const message = error instanceof RoomParticipationUnavailable ? error.message : "The judge is temporarily unavailable.";
    return json({ ok: false, error: { code: "JUDGE_UNAVAILABLE", message } }, 503);
  }
}
