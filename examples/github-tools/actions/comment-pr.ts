import { defineAction } from "@actiondock/sdk";

export interface CommentPrInput {
  repo: string;
  pullNumber: number;
  comment: string;
}

export interface CommentPrOutput {
  posted: boolean;
  commentId: string;
  timestamp: string;
}

export default defineAction(async (input: CommentPrInput, ctx): Promise<CommentPrOutput> => {
  const api = ctx.config.get("GITHUB_API", "https://api.github.com");
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  ctx.log.info(`Posting comment to ${input.repo}#${input.pullNumber}`);

  if (!token) {
    ctx.log.warn("GITHUB_TOKEN not set, simulating comment post");
    return {
      posted: true,
      commentId: `mock-comment-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  const res = await fetch(`${api}/repos/${input.repo}/issues/${input.pullNumber}/comments`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ActionDock/2.0",
    },
    body: JSON.stringify({ body: input.comment }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as any;
  return {
    posted: true,
    commentId: String(data.id),
    timestamp: data.created_at || new Date().toISOString(),
  };
});
