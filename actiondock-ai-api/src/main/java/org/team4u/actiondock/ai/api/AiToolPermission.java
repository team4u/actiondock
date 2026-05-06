package org.team4u.actiondock.ai.api;

public enum AiToolPermission {
    READ_ONLY,
    PROPOSE_CHANGE,
    CONTROLLED_ACTION,
    DANGEROUS_ACTION;

    public boolean allows(AiToolPermission requested) {
        return requested != null && ordinal() >= requested.ordinal();
    }

    public static AiToolPermission from(Object value, AiToolPermission fallback) {
        if (value == null) {
            return fallback;
        }
        if (value instanceof AiToolPermission permission) {
            return permission;
        }
        try {
            return AiToolPermission.valueOf(String.valueOf(value).trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }
}
