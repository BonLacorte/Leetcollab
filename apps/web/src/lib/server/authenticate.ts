type UserLookup = (accessToken: string) => Promise<{ id: string } | null>;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

export async function authenticateBearer(request: Request, lookup: UserLookup): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const user = await lookup(token);
  return user?.id ?? null;
}
