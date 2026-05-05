package org.team4u.actiondock.domain.model;

import java.util.Objects;

public class AiDependency {
    private String capability;
    private String profile;
    private String agentProfile;
    private boolean required = true;

    public String getCapability() { return capability; }
    public AiDependency setCapability(String capability) { this.capability = capability; return this; }
    public String getProfile() { return profile; }
    public AiDependency setProfile(String profile) { this.profile = profile; return this; }
    public String getAgentProfile() { return agentProfile; }
    public AiDependency setAgentProfile(String agentProfile) { this.agentProfile = agentProfile; return this; }
    public boolean isRequired() { return required; }
    public AiDependency setRequired(boolean required) { this.required = required; return this; }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof AiDependency other)) {
            return false;
        }
        return required == other.required
                && Objects.equals(capability, other.capability)
                && Objects.equals(profile, other.profile)
                && Objects.equals(agentProfile, other.agentProfile);
    }

    @Override
    public int hashCode() {
        return Objects.hash(capability, profile, agentProfile, required);
    }

    public AiDependency copy() {
        return new AiDependency()
                .setCapability(capability)
                .setProfile(profile)
                .setAgentProfile(agentProfile)
                .setRequired(required);
    }
}
