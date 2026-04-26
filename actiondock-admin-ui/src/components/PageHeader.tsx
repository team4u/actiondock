import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Row, Space, Typography } from "antd";
import { Col } from "./SafeCol";
import type { ReactNode } from "react";

const { Title, Text } = Typography;

export interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, onBack, backLabel = "返回列表", meta, actions }: PageHeaderProps) {
  return (
    <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
      <Col>
        {onBack ? (
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            style={{ paddingInline: 0 }}
            onClick={onBack}
          >
            {backLabel}
          </Button>
        ) : null}
        <Title level={4} style={{ margin: 0 }}>{title}</Title>
        {meta ? <Text type="secondary">{meta}</Text> : null}
      </Col>
      {actions ? (
        <Col>
          <Space className="page-card-actions" wrap>
            {actions}
          </Space>
        </Col>
      ) : null}
    </Row>
  );
}
