import { Form, Input, Modal, Typography } from "antd";
import type { ForkFormValues } from "../../shared/types";

const { Text } = Typography;

interface ForkScriptModalProps {
  title?: string;
  okText?: string;
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  confirmLoading: boolean;
  form: ReturnType<typeof Form.useForm<ForkFormValues>>[0];
}

export function ForkScriptModal({
  title = "创建可编辑 Fork",
  okText = "确认 Fork",
  open,
  onCancel,
  onOk,
  confirmLoading,
  form
}: ForkScriptModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={okText}
      cancelText="取消"
      confirmLoading={confirmLoading}
      destroyOnHidden
    >
      <Text type="secondary">
        Fork 会复制脚本和定时任务；复制出的定时任务默认停用，配置值继续共享现有全局 Key。
      </Text>
      <Form form={form} layout="vertical">
        <Form.Item
          label="新脚本 ID"
          name="id"
          rules={[
            { required: true, message: "请输入新的脚本 ID" },
            { pattern: /^[A-Za-z0-9._-]+$/, message: "仅支持字母、数字、点、中横线和下划线" }
          ]}
        >
          <Input placeholder="例如 clear-cache-fork" />
        </Form.Item>
        <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
          <Input placeholder="例如 清理缓存 Fork" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
