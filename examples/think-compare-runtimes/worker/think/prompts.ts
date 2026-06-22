import type { RuntimeId } from "../../shared/events";
import { compareFixture } from "../../shared/fixture";

export function runtimeSystemPrompt(runtime: RuntimeId): string {
  const shared = [
    "You are an expert coding agent working on a small documentation repository.",
    "The project root is /workspace.",
    "Use tools immediately; do not spend the turn drafting a long plan in reasoning.",
    "Keep reasoning brief and move to read/write/edit/shell calls quickly.",
    "Inspect the existing files before editing.",
    "Use read for exact file contents, edit for precise replacements, write for new files or full rewrites, and shell to run validation.",
    "Keep changes focused on the task and stop after validation passes.",
  ];

  const runtimeSpecific = runtime === "workspace"
    ? [
        "Runtime: Workspace-backed work surface.",
        "Workspace internals are handled by the application; use the tools as normal coding tools.",
        "Use run for JavaScript file analysis or multi-file edits that do not need a process environment.",
      ]
    : [
        "Runtime: raw Sandbox filesystem.",
        "Use shell for filesystem inspection, validation, and other process work.",
      ];

  return [...shared, "", ...runtimeSpecific].join("\n");
}

export function runtimeTaskPrompt(): string {
  const fixture = compareFixture;
  return [
    fixture.task.brief,
    "",
    "Seeded project files:",
    ...fixture.files.map((file) => `- ${fixture.projectRoot}${file.path}`),
    "",
    "Acceptance criteria:",
    ...fixture.task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Required order:",
    "1. Read the feature brief, style guide, navigation metadata, README, example Worker, and package.json.",
    "2. Write docs/smart-request-policies.md with the TypeScript Worker example and x-bypass-token header.",
    "3. Edit site/navigation.json to add smart-request-policies.",
    "4. Edit README.md so maintainers can find docs/smart-request-policies.md.",
    "5. Do not run npm run check until after docs/smart-request-policies.md, site/navigation.json, and README.md have all been updated.",
    "6. Run npm run check from /workspace and repair any validation failures.",
    "7. Finish with a concise summary of changed files and verification.",
  ].join("\n");
}
