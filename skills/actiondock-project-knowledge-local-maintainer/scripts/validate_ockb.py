#!/usr/bin/env python3
"""Validate a local OCKB project knowledge base."""

from __future__ import annotations

import json
import sys
from pathlib import Path


PILLARS = [
    ".knowledge_base/01_Architecture_Overview",
    ".knowledge_base/02_API_Specifications",
    ".knowledge_base/03_Data_Models",
    ".knowledge_base/04_Business_Flows",
    ".knowledge_base/05_Agent_Tools_and_CLI",
    ".knowledge_base/06_Infra_and_Env",
    ".knowledge_base/07_Maintenance_and_Ops",
]


def rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def issue(code: str, path: str, message: str, repairable: bool = True) -> dict[str, object]:
    return {
        "code": code,
        "path": path,
        "message": message,
        "repairable": repairable,
    }


def check_markdown(root: Path, path: Path) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    path_rel = rel(root, path)
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [issue("read-failed", path_rel, str(exc), False)]

    if not content.strip():
        issues.append(issue("empty-document", path_rel, "Document is empty."))
    if ".actiondock/project-knowledge" in content or ".knowledge-tmp" in content:
        issues.append(issue("temp-reference", path_rel, "Formal document references temporary workspace."))
    lower = content.lower()
    if "todo" in lower or "placeholder" in lower:
        issues.append(issue("placeholder", path_rel, "Formal document contains placeholder text."))
    if content.startswith("---\n"):
        issues.append(issue("frontmatter", path_rel, "Formal document must be pure Markdown without YAML frontmatter."))
    if "```json" in content or "\"bodyMarkdown\"" in content or "touches_tables:" in content or "tags:" in content:
        issues.append(issue("machine-metadata", path_rel, "Formal document contains machine metadata or JSON fragments."))
    if "## 关键结论" in content and "[" not in content:
        issues.append(issue("missing-citation", path_rel, "Document contains conclusions without citations."))
    if path_rel.startswith(".knowledge_base/") and path_rel != ".knowledge_base/SUMMARY.md":
        if "## 证据与边界" not in content:
            issues.append(issue("missing-evidence-boundary", path_rel, "OCKB document must include ## 证据与边界."))
    return issues


def validate(root: Path) -> dict[str, object]:
    issues: list[dict[str, object]] = []

    entry = root / "ACTIONDOCK.md"
    if not entry.exists():
        issues.append(issue("missing-entry", "ACTIONDOCK.md", "ACTIONDOCK.md is missing."))
    elif entry.is_file():
        issues.extend(check_markdown(root, entry))

    summary = root / ".knowledge_base/SUMMARY.md"
    if not summary.exists():
        issues.append(issue("missing-summary", ".knowledge_base/SUMMARY.md", "OCKB SUMMARY.md is missing."))
    elif summary.is_file():
        issues.extend(check_markdown(root, summary))

    for pillar in PILLARS:
        directory = root / pillar
        if not directory.is_dir():
            issues.append(issue("missing-pillar", pillar, "OCKB pillar directory is missing."))
            continue
        for path in sorted(directory.rglob("*.md")):
            if path.is_file():
                issues.extend(check_markdown(root, path))

    return {"ok": not issues, "issues": issues}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: validate_ockb.py <repoPath>", file=sys.stderr)
        return 2
    root = Path(argv[1]).expanduser().resolve()
    if not root.is_dir():
        print(json.dumps({"ok": False, "issues": [issue("invalid-repo", str(root), "repoPath must be a directory.", False)]}, ensure_ascii=False))
        return 1
    result = validate(root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
