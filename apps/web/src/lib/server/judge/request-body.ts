// Count transport bytes before decoding or full JSON parsing. Content-Length is
// only an early rejection hint: chunked and dishonest requests get the same cap.
export const MAX_SUBMISSION_BYTES = 256 * 1024;

export async function readSubmissionJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_SUBMISSION_BYTES)) {
    void request.body?.cancel().catch(() => {});
    throw new Error("Invalid or oversized request length.");
  }
  if (!request.body) throw new Error("Missing JSON body.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SUBMISSION_BYTES) throw new Error("Oversized request body.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
