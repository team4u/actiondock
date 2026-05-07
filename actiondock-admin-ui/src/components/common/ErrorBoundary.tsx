import { Component } from "react";
import type { ReactNode } from "react";
import { Button, Typography } from "antd";

const { Text, Title } = Typography;

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <Title level={3}>页面出现异常</Title>
          <Text type="secondary">{this.state.error?.message}</Text>
          <br />
          <Button
            type="primary"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 16 }}
          >
            重试
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
