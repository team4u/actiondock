import { Col as AntdCol } from "antd";

type ColSpanType = number | string;

interface ColSize {
  span?: ColSpanType;
  offset?: ColSpanType;
  pull?: ColSpanType;
  push?: ColSpanType;
  order?: ColSpanType;
}

export interface SafeColProps extends React.HTMLAttributes<HTMLDivElement> {
  span?: ColSpanType;
  flex?: string | number;
  offset?: ColSpanType;
  order?: ColSpanType;
  pull?: ColSpanType;
  push?: ColSpanType;
  xs?: ColSpanType | ColSize;
  sm?: ColSpanType | ColSize;
  md?: ColSpanType | ColSize;
  lg?: ColSpanType | ColSize;
  xl?: ColSpanType | ColSize;
  xxl?: ColSpanType | ColSize;
}

export const Col = AntdCol as unknown as React.FC<SafeColProps>;
