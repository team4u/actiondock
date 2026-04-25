import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Col, Row, Space } from "antd";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ onBack, backLabel = "返回列表", actions }: PageHeaderProps) {
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
