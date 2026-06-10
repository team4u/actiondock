package org.team4u.actiondock.web.common;

/**
 * 统一 API 响应封装，包含状态码、消息和数据。
 *
 * @author jay.wu
 */
public class ApiResponse<T> {
    private int status;
    private String msg;
    private T data;

    /**
     * 构建成功响应，使用默认消息。
     *
     * @param data 响应数据
     * @return 成功的 API 响应
     */
    public static <T> ApiResponse<T> success(T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.status = 0;
        response.msg = "处理成功";
        response.data = data;
        return response;
    }

    /**
     * 构建成功响应，使用自定义消息。
     *
     * @param data 响应数据
     * @param msg 自定义成功消息
     * @return 成功的 API 响应
     */
    public static <T> ApiResponse<T> success(T data, String msg) {
        ApiResponse<T> response = success(data);
        response.msg = msg;
        return response;
    }

    /**
     * 构建错误响应，使用默认 500 状态码。
     *
     * @param msg 错误消息
     * @return 错误的 API 响应
     */
    public static <T> ApiResponse<T> error(String msg) {
        return error(msg, 500);
    }

    /**
     * 构建错误响应，使用自定义状态码。
     *
     * @param msg 错误消息
     * @param status 自定义错误状态码
     * @return 错误的 API 响应
     */
    public static <T> ApiResponse<T> error(String msg, int status) {
        ApiResponse<T> response = new ApiResponse<>();
        response.status = status;
        response.msg = msg;
        return response;
    }

    /**
     * 构建错误响应，包含自定义状态码和附加数据。
     *
     * @param msg 错误消息
     * @param status 自定义错误状态码
     * @param data 附加错误数据（如校验详情）
     * @return 错误的 API 响应
     */
    public static <T> ApiResponse<T> error(String msg, int status, T data) {
        ApiResponse<T> response = error(msg, status);
        response.data = data;
        return response;
    }

    public int getStatus() {
        return status;
    }

    public String getMsg() {
        return msg;
    }

    public T getData() {
        return data;
    }
}
