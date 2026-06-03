package org.team4u.actiondock.skill;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class SkillFileUtilsTest {

    @TempDir
    Path tempDir;

    @Test
    void swapTempToTargetInstallsWhenTargetDoesNotExist() throws Exception {
        Path target = tempDir.resolve("sample-skill");
        Path temp = tempDir.resolve("sample-skill.tmp-test");
        Files.createDirectories(temp);
        Files.writeString(temp.resolve("SKILL.md"), "new");

        SkillFileUtils.swapTempToTarget(target, temp);

        assertThat(target.resolve("SKILL.md")).hasContent("new");
        assertThat(temp).doesNotExist();
        assertThat(listNames()).doesNotContain("sample-skill.bak-test");
    }

    @Test
    void swapTempToTargetDeletesExistingTargetBeforeInstalling() throws Exception {
        Path target = tempDir.resolve("sample-skill");
        Files.createDirectories(target.resolve("old"));
        Files.writeString(target.resolve("old/file.txt"), "old");
        Files.writeString(target.resolve("SKILL.md"), "old");
        Path temp = tempDir.resolve("sample-skill.tmp-test");
        Files.createDirectories(temp.resolve("new"));
        Files.writeString(temp.resolve("new/file.txt"), "new");
        Files.writeString(temp.resolve("SKILL.md"), "new");

        SkillFileUtils.swapTempToTarget(target, temp);

        assertThat(target.resolve("SKILL.md")).hasContent("new");
        assertThat(target.resolve("new/file.txt")).hasContent("new");
        assertThat(target.resolve("old")).doesNotExist();
        assertThat(temp).doesNotExist();
        assertThat(listNames()).noneMatch(name -> name.startsWith("sample-skill.bak-"));
    }

    @Test
    void tempDirectoryForCleansOldTmpAndBakResidualsForSameTarget() throws Exception {
        Path target = tempDir.resolve("sample-skill");
        Path oldTmp = tempDir.resolve("sample-skill.tmp-old");
        Path oldBak = tempDir.resolve("sample-skill.bak-old");
        Path otherTmp = tempDir.resolve("other-skill.tmp-old");
        Files.createDirectories(oldTmp);
        Files.createDirectories(oldBak);
        Files.createDirectories(otherTmp);
        Files.writeString(oldTmp.resolve("stale.txt"), "tmp");
        Files.writeString(oldBak.resolve("stale.txt"), "bak");

        Path nextTemp = SkillFileUtils.tempDirectoryFor(target);

        assertThat(nextTemp.getFileName().toString()).startsWith("sample-skill.tmp-");
        assertThat(oldTmp).doesNotExist();
        assertThat(oldBak).doesNotExist();
        assertThat(otherTmp).exists();
    }

    private java.util.List<String> listNames() throws Exception {
        try (var stream = Files.list(tempDir)) {
            return stream.map(path -> path.getFileName().toString()).toList();
        }
    }
}
