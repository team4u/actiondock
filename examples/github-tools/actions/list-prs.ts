import { defineAction } from "@actiondock/sdk";

export interface ListPrsInput {
  repo: string;
  state?: "open" | "closed" | "all";
}

/** Pull Request 摘要条目（与 GitHub pulls 列表接口的简化子集对齐） */
export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  created_at: string;
}

export interface ListPrsOutput {
  items: PullRequestSummary[];
  count: number;
  /** 未配置 Token 时返回演示数据，此标记为 true */
  demo?: boolean;
}

export default defineAction(async (input: ListPrsInput, ctx): Promise<ListPrsOutput> => {
  const api = ctx.config.get("GITHUB_API", "https://api.github.com");
  const token = ctx.config.get<string>("GITHUB_TOKEN");
  const state = input.state || "open";

  ctx.log.info(`Fetching pull requests for ${input.repo} (state: ${state})`);

  // If token is not configured or in mock/offline mode, return structured mock data
  if (!token) {
    ctx.log.warn("GITHUB_TOKEN not set, returning demo items");
    // 演示数据使用固定时间戳，保证输出确定性（避免运行时钟影响测试与缓存）
    const mockItems = [
      {
        number: 101,
        title: "feat(core): support bun native compilation",
        author: "octocat",
        state: "open",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        number: 102,
        title: "fix(storage): improve sqlite concurrency with wal",
        author: "team4u",
        state: "open",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    return {
      items: mockItems,
      count: mockItems.length,
      demo: true,
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

  const items = (await res.json()) as PullRequestSummary[];
  return {
    items,
    count: items.length,
  };
});
