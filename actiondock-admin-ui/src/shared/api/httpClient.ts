import { emitAuthRequired, getApiKey } from "../auth/tokenStore";
import type { ApiErrorPayload, ApiResponse } from "../../shared/types";

export const JSON_HEADERS = {
  "Content-Type": "application/json"
};

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", JSON_HEADERS["Content-Type"]);
  }
  const token = getApiKey();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: buildHeaders(init)
  });

  if (response.status === 401) {
    emitAuthRequired();
    throw new ApiError("访问令牌无效或缺失", 401);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? ((await response.json()) as ApiResponse<T> | ApiErrorPayload) : null;

  if (!response.ok) {
    const message = payload && "msg" in payload && payload.msg ? payload.msg : "请求失败";
    const data = payload && "data" in payload ? payload.data : undefined;
    throw new ApiError(message, response.status, data);
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError("接口返回格式不正确", 500);
  }
  return payload.data as T;
}

export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(path, {
    ...init,
    headers: buildHeaders(init)
  });

  if (response.status === 401) {
    emitAuthRequired();
    throw new ApiError("访问令牌无效或缺失", 401);
  }
  if (!response.ok) {
    throw new ApiError("请求失败", response.status);
  }
  return response.blob();
}
