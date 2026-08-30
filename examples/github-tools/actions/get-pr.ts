import { defineAction } from "@actiondock/sdk";

export interface GetPrInput {
  repo: string;
  pullNumber: number;
}

export interface GetPrOutput {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export default defineAction({
  id: "github.get-pr",
  description: "Get detailed information about a specific GitHub pull request",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in owner/repo format" },
      pullNumber: { type: "number", description: "Pull request number" },
    },
    required: ["repo", "pullNumber"],
  },

  outputSchema: {
    type: "object",
    properties: {
      number: { type: "number" },
      title: { type: "string" },
      body: { type: "string" },
      author: { type: "string" },
      state: { type: "string" },
      changedFiles: { type: "number" },
      additions: { type: "number" },
      deletions: { type: "number" },
    },
    required: ["number", "title", "state"],
  },

  async run(input: GetPrInput, ctx): Promise<GetPrOutput> {
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");
    const token = ctx.config.get<string>("GITHUB_TOKEN");

    ctx.log.info(`Fetching PR #${input.pullNumber} for ${input.repo}`);

    if (!token) {
      ctx.log.warn("GITHUB_TOKEN not set, returning demo PR details");
      return {
        number: input.pullNumber,
        title: "feat(core): support bun native compilation",
        body: "This PR replaces the legacy server with Bun standalone build pipeline.",
        author: "octocat",
        state: "open",
        changedFiles: 12,
        additions: 450,
        deletions: 120,
      };
    }

    const res = await fetch(`${api}/repos/${input.repo}/pulls/${input.pullNumber}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "ActionDock/2.0",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    return {
      number: data.number,
      title: data.title,
      body: data.body || "",
      author: data.user?.login || "unknown",
      state: data.state,
      changedFiles: data.changed_files || 0,
      additions: data.additions || 0,
      deletions: data.deletions || 0,
    };
  },
});
