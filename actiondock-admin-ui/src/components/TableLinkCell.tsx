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
    color: "var(--app-primary)",
    textDecoration: "none",
    cursor: onClick ? "pointer" : undefined
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...style,
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit"
        }}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link to={to ?? ""} style={style}>
      {inner}
    </Link>
  );
}
