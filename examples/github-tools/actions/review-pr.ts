import { defineAction } from "@actiondock/sdk";
import getPrAction from "./get-pr";

export interface ReviewPrInput {
  repo: string;
  pullNumber: number;
}

export interface ReviewPrOutput {
  pullNumber: number;
  title: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  summary: string;
  findings: string[];
  reviewedAt: string;
}

export default defineAction({
  id: "github.review-pr",
  description: "Review a pull request and produce automated review findings",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string" },
      pullNumber: { type: "number" },
    },
    required: ["repo", "pullNumber"],
  },

  outputSchema: {
    type: "object",
    properties: {
      pullNumber: { type: "number" },
      title: { type: "string" },
      verdict: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"] },
      summary: { type: "string" },
      findings: { type: "array" },
      reviewedAt: { type: "string" },
    },
    required: ["pullNumber", "title", "verdict", "summary", "findings", "reviewedAt"],
  },

  async run(input: ReviewPrInput, ctx): Promise<ReviewPrOutput> {
    ctx.log.info(`Initiating review for ${input.repo}#${input.pullNumber}`);

    // Action composition: invoke get-pr action
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

    // Persist review checkpoint to shared state store
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
  },
});
