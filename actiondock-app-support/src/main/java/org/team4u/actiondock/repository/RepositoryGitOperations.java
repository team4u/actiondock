package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.skill.SkillFileUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Git 操作服务，封装仓库的 clone/pull/commit/push 等高层命令。
 *
 * @author jay.wu
 */
class RepositoryGitOperations {

    private final Path repositoriesRoot;

    RepositoryGitOperations(Path repositoriesRoot) {
        this.repositoriesRoot = repositoriesRoot;
    }

    void syncGitRepository(RepositoryDefinition repository, Path root) {
        try {
            Files.createDirectories(repositoriesRoot);
        } catch (IOException exception) {
            throw new IllegalStateException("创建本地仓库目录失败", exception);
        }
        if (Files.notExists(root)) {
            GitCommandRunner.runGit(repositoriesRoot, List.of(
                    "git", "clone", "--branch", SkillFileUtils.normalizeOrDefault(repository.getBranch(), "master"),
                    "--single-branch", repository.getUrl(), root.toString()
            ));
            return;
        }
        GitCommandRunner.runGit(root, List.of("git", "-C", root.toString(), "fetch", "origin", SkillFileUtils.normalizeOrDefault(repository.getBranch(), "master")));
        GitCommandRunner.runGit(root, List.of("git", "-C", root.toString(), "checkout", SkillFileUtils.normalizeOrDefault(repository.getBranch(), "master")));
        GitCommandRunner.runGit(root, List.of("git", "-C", root.toString(), "pull", "--ff-only", "origin", SkillFileUtils.normalizeOrDefault(repository.getBranch(), "master")));
    }

    void commitAndPush(Path root, RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
        GitCommandRunner.runGit(root, List.of("git", "-C", root.toString(), "add", "."));
        List<String> commitCommand = new ArrayList<>(List.of(
                "git", "-C", root.toString(), "commit", "-m", "publish(" + toolId + "): " + version
        ));
        String normalizedReleaseNotes = SkillFileUtils.normalizeNullable(releaseNotes);
        if (normalizedReleaseNotes != null) {
            commitCommand.add("-m");
            commitCommand.add(normalizedReleaseNotes);
        }
        GitCommandRunner.runGit(root, commitCommand, true);
        GitCommandRunner.runGit(root, List.of("git", "-C", root.toString(), "push", "origin", SkillFileUtils.normalizeOrDefault(repository.getBranch(), "master")));
    }

    String gitHead(Path root) {
        return GitCommandRunner.gitHead(root);
    }
}
