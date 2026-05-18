import type { ReactNode } from "react";
import { Popconfirm } from "antd";

interface ConfirmDangerActionProps {
  title: string;
  description?: string;
  okText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function ConfirmDangerAction({
  title,
  description,
  okText = "删除",
  cancelText = "取消",
  onConfirm,
  loading = false,
  disabled = false,
  children
}: ConfirmDangerActionProps) {
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={okText}
      cancelText={cancelText}
      onConfirm={onConfirm}
      disabled={disabled}
    >
      {children}
    </Popconfirm>
  );
}
