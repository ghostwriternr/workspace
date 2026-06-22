# @cloudflare/workspace-source-github

GitHub source adapter for Workspace.

This package imports public GitHub repositories through Artifacts and connects
the captured repository authority to a Workspace handle. It keeps GitHub source
identity at the edge while hiding Artifacts import and Workspace adoption
plumbing from examples and product code.

```ts
const github = createGitHubSource({ artifacts: env.ARTIFACTS });
const workspace = workspaces.get("my-project");

const imported = await github.importRepository({
  workspace,
  owner: "cloudflare",
  repo: "sandbox-sdk",
  ref: "main",
});
```

The adapter does not stream GitHub blobs itself. Artifacts owns Git repository
capture; Workspace owns the current files and working-copy apply/discard
semantics after import.
