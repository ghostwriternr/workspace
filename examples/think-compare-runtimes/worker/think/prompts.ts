import type { RuntimeId } from "../../shared/events";
import { compareFixture } from "../../shared/fixture";

export function runtimeSystemPrompt(runtime: RuntimeId): string {
  const shared = [
    "You are an expert coding agent working on a small documentation repository.",
    "The project root is /workspace.",
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
    "Before editing, inspect the feature brief, style guide, navigation metadata, README, and example Worker.",
    "After editing, run npm run check from /workspace and repair any validation failures.",
    "Finish with a concise summary of changed files and verification.",
  ].join("\n");
}
