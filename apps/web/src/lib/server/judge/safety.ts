const forbiddenSourcePatterns: Array<[RegExp, string]> = [
  [/\\u[0-9a-fA-F]{4}/, "Unicode escapes are not supported."],
  [/\bpackage\s+/, "Package declarations are not supported."],
  [/\bimport\s+/, "Import declarations are not supported. Use java.util or java.math with qualified names."],
  [/\bpublic\s+(?:final\s+)?class\s+/, "The Solution class must not be public."],
  [/\bclass\s+Main\b/, "The Main harness class is reserved."],
  [/\bstatic\s+void\s+main\s*\(/, "Entry-point methods are reserved for the judge harness."],
  [/\bSystem\b/, "System access is not supported in submitted solutions."],
  [/\bRuntime\b|\bProcessBuilder\b/, "Process access is not supported."],
  [/\bThread\b|\bExecutor(?:Service)?\b|\bForkJoinPool\b/, "Thread creation is not supported."],
  [/\bClassLoader\b|\bSecurityManager\b|\bjava\s*\.\s*lang\s*\.\s*reflect\b/, "Runtime inspection is not supported."],
  [/\bjava\s*\.\s*(?:io|nio|net)\b/, "File and network APIs are not supported."],
  [/\bjavax\b|\bsun\b|\bjdk\s*\.\s*internal\b/, "This platform API is not supported."],
  [/\bnative\b/, "Native methods are not supported."],
];

export function validateJavaSource(source: string): string | null {
  if (!/\bclass\s+Solution\b/.test(source)) {
    return "Submit one package-private class named Solution.";
  }

  for (const [pattern, message] of forbiddenSourcePatterns) {
    if (pattern.test(source)) return message;
  }

  return null;
}

export function buildJavaProgram(source: string, harnessSource: string): string {
  return `${source.trim()}\n\n${harnessSource.trim()}\n`;
}
