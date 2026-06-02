export const CODING_TOOL_NAMES = ["read", "write", "edit", "run"] as const;

export const CODING_TOOL_DESCRIPTIONS = {
  read: [
    "Read the contents of a file, or list a directory.",
    "Use this for targeted inspection — don't use it to dump entire repo trees.",
  ].join(" "),

  write: [
    "Write content to a file.",
    "Creates the file if it doesn't exist, overwrites if it does.",
    "Automatically creates parent directories.",
  ].join(" "),

  edit: [
    "Edit a file using exact text replacement.",
    "oldText must match exactly once in the file.",
    "Keep oldText as short as possible while still unique.",
    "Read the file first if you're unsure what's there.",
  ].join(" "),

  run: [
    "Run a JavaScript program against the repository.",
    "Use this for searching across files, multi-file refactors, generating content, or anything easier to express in code.",
    "The program runs in an isolated environment with access to repository files through env.WORKSPACE (readFile, writeFile, list, stat).",
    "This is not a shell — no subprocesses, no package manager, no native tools.",
  ].join(" "),
} as const;
