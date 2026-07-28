/**
 * 아티팩트 코드 실행 가능성 판정.
 *
 * 실행 샌드박스(openmake-mcp-runtime)는 `--network none` 으로 격리돼 외부 패키지를 설치할 수
 * 없고 **표준 라이브러리만** 존재한다(2026-07-29 실측: 서드파티 pip 패키지 0개).
 * 따라서 django·express 같은 외부 의존이 있는 코드는 실행하면 반드시 ModuleNotFoundError 로
 * 끝난다. 언어만 보고 실행 버튼을 노출하면 사용자가 "코드가 잘못됐나" 오해하므로,
 * import 를 정적 분석해 미리 걸러낸다.
 *
 * 목록은 샌드박스 이미지에서 직접 추출했다
 * (python3.11 `sys.stdlib_module_names` / node22 `module.builtinModules`).
 */

/** python3.11 표준 라이브러리 (샌드박스 실측) */
const PY_STDLIB = new Set([
    "abc", "aifc", "antigravity", "argparse", "array", "ast", "asynchat", "asyncio", "asyncore", "atexit",
    "audioop", "base64", "bdb", "binascii", "bisect", "builtins", "bz2", "cProfile", "calendar", "cgi",
    "cgitb", "chunk", "cmath", "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall",
    "concurrent", "configparser", "contextlib", "contextvars", "copy", "copyreg", "crypt", "csv", "ctypes", "curses",
    "dataclasses", "datetime", "dbm", "decimal", "difflib", "dis", "distutils", "doctest", "email", "encodings",
    "ensurepip", "enum", "errno", "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib",
    "functools", "gc", "genericpath", "getopt", "getpass", "gettext", "glob", "graphlib", "grp", "gzip",
    "hashlib", "heapq", "hmac", "html", "http", "idlelib", "imaplib", "imghdr", "imp", "importlib",
    "inspect", "io", "ipaddress", "itertools", "json", "keyword", "lib2to3", "linecache", "locale", "logging",
    "lzma", "mailbox", "mailcap", "marshal", "math", "mimetypes", "mmap", "modulefinder", "msilib", "msvcrt",
    "multiprocessing", "netrc", "nis", "nntplib", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator",
    "optparse", "os", "ossaudiodev", "pathlib", "pdb", "pickle", "pickletools", "pipes", "pkgutil", "platform",
    "plistlib", "poplib", "posix", "posixpath", "pprint", "profile", "pstats", "pty", "pwd", "py_compile",
    "pyclbr", "pydoc", "pydoc_data", "pyexpat", "queue", "quopri", "random", "re", "readline", "reprlib",
    "resource", "rlcompleter", "runpy", "sched", "secrets", "select", "selectors", "shelve", "shlex", "shutil",
    "signal", "site", "smtpd", "smtplib", "sndhdr", "socket", "socketserver", "spwd", "sqlite3", "sre_compile",
    "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct", "subprocess", "sunau",
    "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile", "telnetlib", "tempfile", "termios", "textwrap",
    "this", "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback",
    "tracemalloc", "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uu",
    "uuid", "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xdrlib",
    "xml", "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib", "zoneinfo",
]);

/** node22 내장 모듈 (샌드박스 실측) */
const NODE_BUILTINS = new Set([
    "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
    "crypto", "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs",
    "fs/promises", "http", "http2", "https", "inspector", "inspector/promises", "module", "net",
    "os", "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring",
    "readline", "readline/promises", "repl", "stream", "stream/consumers", "stream/promises", "stream/web", "string_decoder",
    "sys", "timers", "timers/promises", "tls", "trace_events", "tty", "url", "util",
    "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

/** 서버 실행 가능 언어 (백엔드 ARTIFACT_EXEC_RUNTIMES 와 정합) */
const PY_LANGS = new Set(["python", "py", "python3"]);
const JS_LANGS = new Set(["javascript", "js", "node", "nodejs"]);

export type RunnableVerdict =
  /** 실행 가능 */
  | { runnable: true }
  /** 서버가 실행을 지원하지 않는 언어 */
  | { runnable: false; reason: "unsupported-language" }
  /** 샌드박스에 없는 외부 패키지에 의존 */
  | { runnable: false; reason: "external-deps"; packages: string[] };

/** import 스펙에서 최상위 패키지명만 추출 (`django.http` → `django`, `node:fs` → `fs`) */
function topLevel(spec: string): string {
  const bare = spec.replace(/^node:/, "");
  // node 내장은 'fs/promises' 처럼 슬래시 형태가 그대로 유효하므로 먼저 확인
  if (NODE_BUILTINS.has(bare)) return bare;
  return bare.split("/")[0]!.split(".")[0]!;
}

/** 상대경로 import 는 같은 아티팩트 내 참조이므로 외부 의존이 아니다. */
function isRelative(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

function pythonImports(code: string): string[] {
  const found = new Set<string>();
  // `import a, b.c as x`
  for (const m of code.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]!.trim();
      if (name && !isRelative(name)) found.add(topLevel(name));
    }
  }
  // `from a.b import c` — `from . import x` 같은 상대 import 는 제외
  for (const m of code.matchAll(/^[ \t]*from[ \t]+(\S+)[ \t]+import[ \t]/gm)) {
    const name = m[1]!.trim();
    if (name && !isRelative(name)) found.add(topLevel(name));
  }
  return [...found];
}

function jsImports(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const s = m[1]!;
    if (!isRelative(s)) found.add(topLevel(s));
  }
  for (const m of code.matchAll(/^[ \t]*import\s+(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/gm)) {
    const s = m[1]!;
    if (!isRelative(s)) found.add(topLevel(s));
  }
  return [...found];
}

/**
 * 이 코드가 실행 샌드박스에서 돌 수 있는지 판정한다.
 *
 * @param lang - 아티팩트 language (대소문자 무관)
 * @param code - 아티팩트 본문
 */
export function checkRunnable(lang: string | null | undefined, code: string): RunnableVerdict {
  const l = (lang ?? "").toLowerCase().trim();
  const isPy = PY_LANGS.has(l);
  const isJs = JS_LANGS.has(l);
  if (!isPy && !isJs) return { runnable: false, reason: "unsupported-language" };

  const imports = isPy ? pythonImports(code) : jsImports(code);
  const known = isPy ? PY_STDLIB : NODE_BUILTINS;
  const missing = imports.filter((m) => !known.has(m)).sort();

  return missing.length > 0
    ? { runnable: false, reason: "external-deps", packages: missing }
    : { runnable: true };
}
