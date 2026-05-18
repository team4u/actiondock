import { Alert, Button, Drawer, Input, Space } from "antd";

interface GeneratedScriptImportModalProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onImport: () => void;
  onCancel: () => void;
}

export function GeneratedScriptImportModal({
  open,
  value,
  onChange,
  onImport,
  onCancel
}: GeneratedScriptImportModalProps) {
  return (
    <Drawer
      title="粘贴 generate-script 输出"
      open={open}
      width={760}
      onClose={onCancel}
      extra={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={onImport}>导入</Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="支持固定格式，也支持从 Groovy/Python 源码智能提取"
          description="带有显式 Input/Output Schema 时优先使用原始 Schema；仅粘贴源码时会自动提取输入输出结构，并按源码语言回填脚本类型。"
        />
        <Input.TextArea
          className="generated-script-textarea"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          placeholder={`支持两种粘贴方式，例如：\n\n1. 固定格式\n### 脚本 ID\nhello-python\n\n### 脚本名称\nHello Python\n\n### Python 脚本\n\`\`\`python\nname = input.get("name") or "World"\nreturn {"message": f"Hello, {name}!"}\n\`\`\`\n\n### Input Schema（输入参数）\n\`\`\`json\n{\n  "type": "object",\n  "properties": {}\n}\n\`\`\`\n\n### Output Schema（输出结果）\n\`\`\`json\n{\n  "type": "object",\n  "properties": {}\n}\n\`\`\`\n\n2. 直接粘贴源码\n\`\`\`groovy\ndef name = input.name ?: "World"\nreturn [message: "Hello, \${name}!"]\n\`\`\``}
          autoSize={{ minRows: 14, maxRows: 22 }}
        />
      </Space>
    </Drawer>
  );
}
