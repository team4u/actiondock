import { defineAction } from "@actiondock/sdk";
import getPrAction, { type GetPrInput, type GetPrOutput } from "./get-pr";

/**
 * 审查 Pull Request 的输入参数接口。
 */
export interface ReviewPrInput {
  /** GitHub 仓库名（格式：owner/repo） */
  repo: string;
  /** PR 编号 */
  pullNumber: number;
}

/**
 * 审查结果输出接口。
 */
export interface ReviewPrOutput {
  pullNumber: number;
  title: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  summary: string;
  findings: string[];
  reviewedAt: string;
}

/**
 * 自动化代码审查 Action：演示 Action 编排与嵌套调用（ctx.actions.invoke）、配置读取与状态持久化。
 */
export default defineAction(async (input: ReviewPrInput, ctx): Promise<ReviewPrOutput> => {
  ctx.log.info(`Initiating review for ${input.repo}#${input.pullNumber}`);

  // Action 组合：调用 get-pr 动作
  const pr = await ctx.actions.invoke(getPrAction, {
    repo: input.repo,
    pullNumber: input.pullNumber,
  });

  const findings: string[] = [];

  if (pr.changedFiles > 20) {
    findings.push("Large PR: more than 20 files modified. Consider splitting into smaller chunks.");
  }
  if (!pr.body || pr.body.length < 20) {
    findings.push("PR description is very brief. Provide additional context for reviewers.");
  }
  if (pr.title.toLowerCase().includes("wip")) {
    findings.push("PR title indicates Work In Progress (WIP).");
  }

  const verdict = findings.length > 1 ? "REQUEST_CHANGES" : "APPROVE";
  const summary = findings.length === 0
    ? `PR #${pr.number} looks great! All standard health checks passed.`
    : `PR #${pr.number} has ${findings.length} item(s) to address.`;

  const now = new Date().toISOString();

  // 持久化审查检查点至状态存储
  await ctx.state.set(`review:${input.repo}:${input.pullNumber}`, {
    verdict,
    reviewedAt: now,
  });

  return {
    pullNumber: pr.number,
    title: pr.title,
    verdict,
    summary,
    findings,
    reviewedAt: now,
  };
});
