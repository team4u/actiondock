import type { MessageInstance } from "antd/es/message/interface";
import { copyText } from "../../services/utils";

export function useCopyMessage(
  messageApi: MessageInstance,
  defaultSuccessText = "已复制",
  defaultErrorText = "复制失败"
) {
  return async (value: string, successText?: string, errorText?: string): Promise<boolean> => {
    try {
      await copyText(value);
      messageApi.success(successText ?? defaultSuccessText);
      return true;
    } catch {
      messageApi.error(errorText ?? defaultErrorText);
      return false;
    }
  };
}
