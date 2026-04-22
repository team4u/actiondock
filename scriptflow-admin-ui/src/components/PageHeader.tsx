import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Space, Typography } from "antd";
import type { ReactNode } from "react";

const { Title } = Typography;

export interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, onBack, backLabel = "返回列表", meta, actions }: PageHeaderProps) {
  return (
    <Card>
      <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
        <Col>
          <Space direction="vertical" size={2}>
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
            <Title level={4} style={{ margin: 0 }}>
              {title}
            </Title>
            {meta}
          </Space>
        </Col>
        {actions ? (
          <Col>
            <Space className="page-card-actions" wrap>
              {actions}
            </Space>
          </Col>
        ) : null}
      </Row>
    </Card>
  );
}
