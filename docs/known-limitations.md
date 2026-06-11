# Known limitations

Accepted gaps in the current prototype. Remove entries when they stop being
true.

## File mutation uses temporary internal Git plumbing

Workspace is backed by Artifacts, but Artifacts does not yet expose direct file
write, commit, and apply/discard APIs for the full Workspace flow.
`packages/workspace` currently uses internal `isomorphic-git` plus an in-memory
filesystem to clone, edit, commit, and push repositories.

That plumbing is hidden behind the Workspace API. It should be deleted when
Artifacts exposes first-class file mutation primitives.

## Writes can be memory-heavy

Current write and apply paths may need enough Git history and objects to push
successfully. Large repositories can be slow or memory-heavy.

This is an implementation limitation of the temporary Git bridge, not a
Workspace API promise.

## Empty directories are not durable entries

Artifacts/Git does not preserve empty directories. Workspace can infer
directories from file paths for `list` and `stat`, and scoped writes can create
parents as needed, but an empty `mkdir` with no files beneath it is not durable
in the current Artifacts-backed prototype.

If real callers need durable empty directories, the Artifacts file API or
Workspace layer needs an explicit representation that does not turn Workspace
into a parallel file store.

## Source provenance is not modeled yet

Source adapters can import or seed Workspace state, but Workspace does not yet
record where files came from. That limits display, export, and adapter-specific
change calculation.

Provenance should be metadata about Workspace state, not source lifecycle or
auto-sync.

## GitHub source import is minimal

The GitHub source adapter imports public repositories through Artifacts and
connects the captured authority to a Workspace. It does not yet resolve and
report the captured Git commit, support private repository credentials, export
changes back to GitHub, or create pull requests.

## Sandbox adapter uses a local base image

The current Sandbox adapter uses a local `workspace-sandbox-base:local` image
that packages `artifact-fs` and Workspace wrapper scripts. This keeps the
runtime contract shared by examples, but it is not a published base image yet.

Sandbox outbound Workers/TLS auth is still future work. Today the mounted Git
remote must be usable by `artifact-fs` from inside the Sandbox image. The target
credential boundary is still token-free HTTPS remotes in the container with a
trusted outbound handler injecting short-lived Artifacts Git credentials outside
sandboxed code.

## Runtime-local mounts are basic

The current Sandbox adapter does not deeply model runtime-local authorities such
as `node_modules`, `.venv`, compiler caches, or scratch directories. Products
can still avoid publishing those paths by controlling commands and scopes, but a
richer runtime-local mount model is future adapter work.

## Dynamic Worker module and asset projections are not built

The prototype validates scoped Dynamic Worker file capabilities over a working
copy. It does not yet load Dynamic Worker modules or static assets from
Workspace trees.

## No working-copy cleanup

Working copies left open indefinitely remain as hidden Artifacts refs. Callers
must explicitly apply or discard them; there is no sweep, TTL, or orphan
recovery.

## No revision retention policy

Revisions are retained by the Artifacts repository history. There is no
Workspace-level retention, pruning, or export policy yet.
