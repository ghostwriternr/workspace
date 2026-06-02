export type CodingToolDefinition = {
  name: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
};

export const CODING_TOOLS: CodingToolDefinition[] = [
  {
    name: "read",
    description:
      "Read the contents of a file, or list a directory. Returns text content for files, entry names for directories.",
    promptSnippet: "Read file contents or list a directory",
    promptGuidelines: [
      "Use read to look at files. Use it for targeted inspection, not to dump entire directories.",
    ],
  },
  {
    name: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: [
      "Use write only for new files or complete rewrites.",
    ],
  },
  {
    name: "edit",
    description:
      "Edit a file using exact text replacement. oldText must match exactly once in the file. Keep oldText as short as possible while still unique. Read the file first if you're unsure what's there.",
    promptSnippet: "Make precise text replacements in existing files",
    promptGuidelines: [
      "Use edit for precise changes (oldText must match exactly).",
      "Keep oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
  },
  {
    name: "run",
    description:
      "Run a JavaScript program against the repository. Use this for searching across files, multi-file refactors, generating content, or anything easier to express in code. The program runs in an isolated environment with access to repository files through env.WORKSPACE (readFile, writeFile, list, stat). This is not a shell — no subprocesses, no package manager, no native tools.",
    promptSnippet: "Run JavaScript programs against the repository",
    promptGuidelines: [
      "Use run for anything that's easier in code: searching across files, multi-file refactors, generating content, computing summaries.",
      "When using run, code must default-export an async function that takes env. Files are accessed through env.WORKSPACE, which has readFile, writeFile, list, and stat. These methods return { status: 'ok', value } or { status: 'error', error } — always check status before using the value. Use TextDecoder/TextEncoder for text.",
      "run is not a shell — no subprocesses, no package manager, no native tools. But it runs full JavaScript, so use it freely for anything you can express in code.",
    ],
  },
];

export const CODING_TOOL_NAMES = CODING_TOOLS.map((t) => t.name);
