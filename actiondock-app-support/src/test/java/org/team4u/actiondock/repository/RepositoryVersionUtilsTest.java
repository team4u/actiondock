package org.team4u.actiondock.repository;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RepositoryVersionUtilsTest {

    @Test
    void versionSatisfies_gteWithSpace() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.1", ">= 0.1.0"));
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.1", ">=0.1.0"));
        assertTrue(RepositoryVersionUtils.versionSatisfies("1.0.0", ">= 0.1.0"));
    }

    @Test
    void versionSatisfies_gteBoundary() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.0", ">= 0.1.0"));
        assertFalse(RepositoryVersionUtils.versionSatisfies("0.0.9", ">= 0.1.0"));
    }

    @Test
    void versionSatisfies_rangeWithSpaces() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("1.5.0", ">= 1.0.0 < 2.0.0"));
        assertTrue(RepositoryVersionUtils.versionSatisfies("1.5.0", ">=1.0.0 <2.0.0"));
        assertFalse(RepositoryVersionUtils.versionSatisfies("2.0.0", ">= 1.0.0 < 2.0.0"));
    }

    @Test
    void versionSatisfies_emptyRange() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.1", null));
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.1", ""));
    }

    @Test
    void versionSatisfies_exactMatch() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.0", "0.1.0"));
        assertFalse(RepositoryVersionUtils.versionSatisfies("0.1.1", "0.1.0"));
    }

    @Test
    void versionSatisfies_withVPrefix() {
        assertTrue(RepositoryVersionUtils.versionSatisfies("v0.1.1", ">=0.1.0"));
        assertTrue(RepositoryVersionUtils.versionSatisfies("0.1.1", ">=v0.1.0"));
    }
}
