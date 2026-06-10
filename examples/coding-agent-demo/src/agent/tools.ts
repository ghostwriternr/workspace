export type CodingToolDefinition<Name extends string = string> = {
  name: Name;
  description: string;
  promptSnippet: string;
  promptGuidelines: readonly string[];
};

export const CODING_TOOLS = [
  {
    name: "read",
    description:
      "Read the contents of a file, or list a directory. File reads are truncated at 2000 lines or 50KB by default. Use offset and limit to continue through large files.",
    promptSnippet: "Read file contents or list a directory",
    promptGuidelines: [
      "Use read to look at files. Use it for targeted inspection, not to dump entire directories.",
      "File reads are truncated at 2000 lines or 50KB. Use offset and limit when you need more of a large file.",
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
  {
    name: "shell",
    description:
      "Run a shell command in an isolated Sandbox with the working copy mounted at /workspace. Use this for package managers, test runners, native tools, and process execution. Command execution does not publish changes and does not capture filesystem changes by itself.",
    promptSnippet: "Run shell commands against the mounted working copy",
    promptGuidelines: [
      "Use shell when you need package managers, test runners, native tools, or real process execution.",
      "shell runs with the working copy mounted at /workspace. Use paths under /workspace in commands.",
      "After a shell command writes files you want to keep, call capture to update the durable working copy.",
    ],
  },
  {
    name: "capture",
    description:
      "Capture files written under the Sandbox /workspace mount back into the durable working copy. This does not apply or publish the working copy.",
    promptSnippet: "Capture Sandbox filesystem changes into the working copy",
    promptGuidelines: [
      "Use capture after shell commands that create or modify files under /workspace and should become part of the working copy.",
      "capture updates the durable working copy but does not publish it. The user still decides whether to apply or discard.",
    ],
  },
] as const satisfies readonly CodingToolDefinition[];

export type CodingToolName = typeof CODING_TOOLS[number]["name"];
type CodingTool = Extract<typeof CODING_TOOLS[number], { name: CodingToolName }>;

export const CODING_TOOL_NAMES = CODING_TOOLS.map((tool) => tool.name) as CodingToolName[];

export function codingToolDescription(name: CodingToolName): string {
  return codingTool(name).description;
}

function codingTool(name: CodingToolName): CodingTool {
  const definition = CODING_TOOLS.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Unknown coding tool: ${name}`);
  }
  return definition;
}
