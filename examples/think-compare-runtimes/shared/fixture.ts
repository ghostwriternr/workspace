export interface FixtureFile {
  path: string;
  contents: string;
}

export interface ComparisonFixture {
  projectRoot: "/workspace/repo";
  task: {
    title: string;
    brief: string;
    acceptanceCriteria: string[];
  };
  files: FixtureFile[];
}

export const compareFixture: ComparisonFixture = {
  projectRoot: "/workspace/repo",
  task: {
    title: "Document Smart Request Policies",
    brief:
      "Use the feature brief, style guide, existing docs, and examples to add a Smart Request Policies docs page and update the surrounding docs metadata.",
    acceptanceCriteria: [
      "Create docs/smart-request-policies.md",
      "Update site/navigation.json with the new page",
      "Update README.md so maintainers can find the page",
      "Include a TypeScript Worker example",
      "Run npm run check and repair any validation failures",
    ],
  },
  files: [
    {
      path: "/package.json",
      contents: `${JSON.stringify(
        {
          scripts: {
            check: "node --check docs/examples/basic-worker.ts && node -e \"const fs=require('fs'); const nav=JSON.parse(fs.readFileSync('site/navigation.json','utf8')); const page=fs.readFileSync('docs/smart-request-policies.md','utf8'); if(!page.includes('x-bypass-token')) throw new Error('missing token header'); if(!JSON.stringify(nav).includes('smart-request-policies')) throw new Error('missing nav item');\"",
          },
          dependencies: {},
          devDependencies: {},
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "/README.md",
      contents:
        "# Workers docs fixture\n\nThis miniature repository contains docs, navigation metadata, and examples for a Cloudflare Workers documentation task.\n\nRun `npm run check` after documentation changes are complete.\n",
    },
    {
      path: "/docs/feature-brief.md",
      contents:
        "# Smart Request Policies\n\nSmart Request Policies let Workers evaluate incoming requests against declarative method, path, header, and risk-signal rules before application handlers run. The feature is in beta for Enterprise customers.\n\n## Requirements\n\n- Document how safe methods can be allowed directly.\n- Document how mutating methods can require an `x-bypass-token` header.\n- Mention that policies do not replace application authorization.\n- Include a small TypeScript Worker example.\n",
    },
    {
      path: "/docs/style-guide.md",
      contents:
        "# Docs style guide\n\nWrite directly for developers. Start with what the feature does, then show a concrete example. Include beta limitations in a clearly labeled section. Avoid marketing claims.\n",
    },
    {
      path: "/docs/examples/basic-worker.ts",
      contents:
        "export default {\n  async fetch(request: Request): Promise<Response> {\n    const url = new URL(request.url);\n\n    if (request.method === 'GET' && url.pathname === '/health') {\n      return Response.json({ ok: true });\n    }\n\n    return new Response('Not found', { status: 404 });\n  },\n};\n",
    },
    {
      path: "/site/navigation.json",
      contents: `${JSON.stringify(
        {
          sections: [
            {
              title: "Workers",
              items: [
                { title: "Overview", path: "/workers/" },
                { title: "Routing", path: "/workers/routing/" },
                { title: "Security", path: "/workers/security/" },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
    },
  ],
};

export function fixtureFileEntries(): FixtureFile[] {
  return compareFixture.files.map((file) => ({ ...file }));
}

export function fixtureManifest(): string {
  const files = compareFixture.files.map((file) => `- ${file.path.slice(1)}`).join("\n");
  const criteria = compareFixture.task.acceptanceCriteria.map((item) => `- ${item}`).join("\n");

  return [`Task: ${compareFixture.task.title}`, "", compareFixture.task.brief, "", "Files:", files, "", "Acceptance criteria:", criteria].join("\n");
}
