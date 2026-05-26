package org.team4u.actiondock.browser.plugin;

import java.util.ArrayList;
import java.util.List;

public class BrowserPluginConfig {
    private String defaultBrowser = "chromium";
    private boolean headless = true;
    private int defaultTimeoutMs = 30000;
    private int sessionTtlSeconds = 600;
    private int maxSessions = 10;
    private String stateDir = ".actiondock/browser-state";
    private String artifactDir = ".actiondock/browser-artifacts";
    private String downloadDir = ".actiondock/browser-downloads";
    private List<String> allowedHosts = new ArrayList<>();
    private boolean includeCookieValueByDefault = false;

    public String getDefaultBrowser() {
        return defaultBrowser;
    }

    public BrowserPluginConfig setDefaultBrowser(String defaultBrowser) {
        this.defaultBrowser = defaultBrowser;
        return this;
    }

    public boolean isHeadless() {
        return headless;
    }

    public BrowserPluginConfig setHeadless(boolean headless) {
        this.headless = headless;
        return this;
    }

    public int getDefaultTimeoutMs() {
        return defaultTimeoutMs;
    }

    public BrowserPluginConfig setDefaultTimeoutMs(int defaultTimeoutMs) {
        this.defaultTimeoutMs = defaultTimeoutMs;
        return this;
    }

    public int getSessionTtlSeconds() {
        return sessionTtlSeconds;
    }

    public BrowserPluginConfig setSessionTtlSeconds(int sessionTtlSeconds) {
        this.sessionTtlSeconds = sessionTtlSeconds;
        return this;
    }

    public int getMaxSessions() {
        return maxSessions;
    }

    public BrowserPluginConfig setMaxSessions(int maxSessions) {
        this.maxSessions = maxSessions;
        return this;
    }

    public String getStateDir() {
        return stateDir;
    }

    public BrowserPluginConfig setStateDir(String stateDir) {
        this.stateDir = stateDir;
        return this;
    }

    public String getArtifactDir() {
        return artifactDir;
    }

    public BrowserPluginConfig setArtifactDir(String artifactDir) {
        this.artifactDir = artifactDir;
        return this;
    }

    public String getDownloadDir() {
        return downloadDir;
    }

    public BrowserPluginConfig setDownloadDir(String downloadDir) {
        this.downloadDir = downloadDir;
        return this;
    }

    public List<String> getAllowedHosts() {
        return allowedHosts;
    }

    public BrowserPluginConfig setAllowedHosts(List<String> allowedHosts) {
        this.allowedHosts = allowedHosts == null ? new ArrayList<>() : new ArrayList<>(allowedHosts);
        return this;
    }

    public boolean isIncludeCookieValueByDefault() {
        return includeCookieValueByDefault;
    }

    public BrowserPluginConfig setIncludeCookieValueByDefault(boolean includeCookieValueByDefault) {
        this.includeCookieValueByDefault = includeCookieValueByDefault;
        return this;
    }
}
