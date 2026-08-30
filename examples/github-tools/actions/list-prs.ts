import { defineAction } from "@actiondock/sdk";

export interface ListPrsInput {
  repo: string;
  state?: "open" | "closed" | "all";
}

export default defineAction({
  id: "github.list-prs",
  description: "List pull requests for a GitHub repository",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in owner/repo format" },
      state: {
        type: "string",
        enum: ["open", "closed", "all"],
        default: "open",
      },
    },
    required: ["repo"],
  },

  outputSchema: {
    type: "object",
    properties: {
      items: { type: "array" },
      count: { type: "number" },
    },
    required: ["items", "count"],
  },

  async run(input: ListPrsInput, ctx) {
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const state = input.state || "open";

    ctx.log.info(`Fetching pull requests for ${input.repo} (state: ${state})`);

    // If token is not configured or in mock/offline mode, return structured mock data
    if (!token) {
      ctx.log.warn("GITHUB_TOKEN not set, returning demo items");
      const mockItems = [
        {
          number: 101,
          title: "feat(core): support bun native compilation",
          author: "octocat",
          state: "open",
          created_at: new Date().toISOString(),
        },
        {
          number: 102,
          title: "fix(storage): improve sqlite concurrency with wal",
          author: "team4u",
          state: "open",
          created_at: new Date().toISOString(),
        },
      ];
      return {
        items: mockItems,
        count: mockItems.length,
      };
    }

    const res = await fetch(`${api}/repos/${input.repo}/pulls?state=${state}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "ActionDock/2.0",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
    }

    const items = (await res.json()) as any[];
    return {
      items,
      count: items.length,
    };
  },
});
