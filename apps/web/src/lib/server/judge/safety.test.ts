import { describe, expect, it } from "vitest";
import { buildJavaProgram, validateJavaSource } from "./safety";

describe("Java submission boundary", () => {
  it("accepts a package-private Solution using qualified collection APIs", () => {
    const source = "class Solution { static int size() { return new java.util.ArrayList<Integer>().size(); } }";
    expect(validateJavaSource(source)).toBeNull();
    expect(buildJavaProgram(source, "class Main {}")).toContain("class Main");
  });

  it.each([
    ["class Solution { void x() { new java.net.Socket(); } }", "network"],
    ["class Solution { void x() { Runtime.getRuntime(); } }", "Process"],
    ["class Solution { static void main(String[] x) {} }", "Entry-point"],
    ["class Solution { String x = \\\"\\\\u0053ystem\\\"; }", "Unicode"],
    ["public class Solution {}", "must not be public"],
  ])("rejects unsupported source operations", (source, reason) => {
    expect(validateJavaSource(source)).toContain(reason);
  });

  it("requires the owned harness contract", () => {
    expect(validateJavaSource("class Answer {}")) .toContain("Solution");
  });

  it.each([
    "import java.util.Stack;",
    "import java.math.BigInteger; import java.util.ArrayList;",
    "import java.util.*; import java.math.*;",
    "import\njava . util . Stack ;",
  ])("allows supported package imports: %s", imports => {
    const source = `${imports}\nclass Solution {}`;
    expect(validateJavaSource(source)).toBeNull();
    expect(buildJavaProgram(source, "class Main {}")).toBe(`${source}\n\nclass Main {}\n`);
  });

  it.each([
    "import java.io.File;",
    "import java.net.*;",
    "import java.nio.file.Files;",
    "import java.lang.reflect.Method;",
    "import javax.crypto.Cipher;",
    "import sun.misc.Unsafe;",
    "import jdk.internal.misc.Unsafe;",
    "import java.util.concurrent.*;",
    "import static java.math.BigInteger.ONE;",
    "import static java.util.Collections.*;",
    "import java.util.Map.Entry;",
    "import java.util.Stack",
    "import java.util.Stack; import external.Library;",
    "import java./* comment */io.File;",
    "import java.util.Stack; import java.util.concurrent.Executors;",
  ])("rejects unsupported or malformed imports: %s", imports => {
    expect(validateJavaSource(`${imports}\nclass Solution {}`)).not.toBeNull();
  });

  it.each([
    "System.exit(0);",
    "Runtime.getRuntime();",
    "new ProcessBuilder();",
    "new Thread();",
    "ExecutorService executor;",
    "ForkJoinPool pool;",
    "ClassLoader loader;",
    "SecurityManager manager;",
    "java.lang.reflect.Method method;",
    "new java.io.File(\"x\");",
    "new java.net.Socket();",
    "java.nio.file.Path path;",
    "javax.crypto.Cipher cipher;",
  ])("retains forbidden API checks with allowed imports: %s", operation => {
    expect(validateJavaSource(`import java.util.*;\nclass Solution { void x() { ${operation} } }`)).not.toBeNull();
  });

  it.each([
    "public class Solution {}",
    "class Solution {} class Main {}",
    "class Solution { static void main(String[] args) {} }",
    "class Solution { native int x(); }",
    "package example; class Solution {}",
    String.raw`class Solution { String x = "\u0053ystem"; }`,
  ])("retains reserved-source restrictions with imports: %s", source => {
    expect(validateJavaSource(`import java.util.Stack;\n${source}`)).not.toBeNull();
  });
});

it.each(["import java./* note */util.Stack;", "import/* note */java.math.BigInteger;", "import java.// note\nutil.Stack;"])(
  "recognizes comments as whitespace in supported imports: %s", declaration => {
    const source = declaration + "\nclass Solution {}";
    expect(validateJavaSource(source)).toBeNull();
    expect(buildJavaProgram(source, "class Main {}")).toBe(source + "\n\nclass Main {}\n");
  },
);

it.each(["import/* note */java.time.LocalDate;", "import/* note */static java.util.Collections.sort;"])(
  "rejects unsupported imports across comment boundaries: %s", declaration => {
    expect(validateJavaSource(declaration + "\nclass Solution {}")).toContain("Only non-static imports");
  },
);
