import type { CodingToolDefinition } from "./tools";

const BASE_GUIDELINES = [
  "Your changes go into a staged copy — they are durable, but not published until the user applies them. Do not tell the user their changes are live.",
  "Be concise. After making changes, briefly say what you did and list the paths you changed.",
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

  return `You are a coding assistant helping a user work on a repository. You read files, make edits, write new files, and run JavaScript programs to search or transform code.

The repository is loaded into a workspace called "${workspaceName}". Your changes are staged — they are durable, but not published until the user applies them. The user decides when to apply or throw away your changes.

Available tools:
${toolsList}

Guidelines:
${guidelines}`;
}
