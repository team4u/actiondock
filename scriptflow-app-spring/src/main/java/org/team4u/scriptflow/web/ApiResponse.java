package org.team4u.scriptflow.web;

public class ApiResponse<T> {
    private int status;
    private String msg;
    private T data;

    public static <T> ApiResponse<T> success(T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.status = 0;
        response.msg = "处理成功";
        response.data = data;
        return response;
    }

    public static <T> ApiResponse<T> success(T data, String msg) {
        ApiResponse<T> response = success(data);
        response.msg = msg;
        return response;
    }

    public static <T> ApiResponse<T> error(String msg) {
        return error(msg, 500);
    }

    public static <T> ApiResponse<T> error(String msg, int status) {
        ApiResponse<T> response = new ApiResponse<>();
        response.status = status;
        response.msg = msg;
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
