package org.team4u.actiondock.application;

/**
 * 通用对象值转换工具。
 *
 * @author jay.wu
 */
public final class ObjectValues {

    private ObjectValues() {
    }

    public static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
