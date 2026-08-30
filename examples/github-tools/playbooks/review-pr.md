---
id: review-pr
description: SOP for reviewing a pull request, inspecting diffs, and leaving structured review comments
actions:
  - github.list-prs
  - github.get-pr
  - github.review-pr
  - github.comment-pr
---

# Pull Request Review SOP

This playbook guides an AI Agent through reviewing a GitHub Pull Request using the standalone `github-tools` binary.

## Steps

1. **Discover & Inspect PR**:
   - Run \`github.get-pr\` to fetch the title, author, description, and statistics for the target pull request.
2. **Execute Automated Review**:
   - Run \`github.review-pr\` to perform structural and sanity checks (PR size, description quality, WIP detection).
   - Check the resulting review verdict and findings.
3. **Leave Review Comment**:
   - Run \`github.comment-pr\` to post the findings and summary to the PR discussion.
   - Never auto-merge unless explicitly requested by the user.
