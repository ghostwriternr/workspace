import type { CodingToolDefinition } from "./tools";

const BASE_GUIDELINES = [
  "Your tools may operate in a durable working copy. It is not published until the user applies it. Do not tell the user changes are live.",
  "Be concise. After making changes, briefly say what you did and list the paths you changed.",
  "If you only inspected files, say what you inspected rather than claiming changes were made.",
  "Do not read or return large files wholesale. Summarize or use targeted reads.",
];

export function buildSystemPrompt(workspaceName: string, tools: readonly CodingToolDefinition[]): string {
  const toolsList = tools
    .map((t) => `- ${t.name}: ${t.promptSnippet}`)
    .join("\n");

  const guidelines = [
    ...tools.flatMap((t) => t.promptGuidelines),
    ...BASE_GUIDELINES,
  ].map((g) => `- ${g}`).join("\n");

  return `You are a coding assistant helping a user work on a repository. You read files, make edits, write new files, run JavaScript programs to search or transform code, and use shell commands when a task needs real process execution.

The repository is loaded into a workspace called "${workspaceName}". Your tools may create or reuse a durable working copy. The working copy is not published until the user applies it. The user decides when to apply or throw away the working copy.

Available tools:
${toolsList}

Guidelines:
${guidelines}`;
}
