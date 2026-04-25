import type { ReactNode, MouseEventHandler } from "react";
import { Link } from "react-router-dom";

export function TableLinkCell({
  children,
  to,
  onClick,
  title,
  ellipsis = false
}: {
  children: ReactNode;
  to?: string;
  onClick?: MouseEventHandler;
  title?: string;
  ellipsis?: boolean;
}) {
  const inner = ellipsis ? (
    <span
      title={title}
      style={{
        display: "inline-block",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  ) : (
    children
  );

  const style = {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    color: "#1677ff",
    textDecoration: "none",
    cursor: onClick ? "pointer" : undefined
  };

  if (onClick) {
    return <span style={style} onClick={onClick}>{inner}</span>;
  }

  return (
    <Link to={to ?? ""} style={style}>
      {inner}
    </Link>
  );
}
