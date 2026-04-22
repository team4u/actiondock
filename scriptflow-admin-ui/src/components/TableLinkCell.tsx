import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function TableLinkCell({
  children,
  to,
  title,
  ellipsis = false
}: {
  children: ReactNode;
  to: string;
  title?: string;
  ellipsis?: boolean;
}) {
  return (
    <Link
      to={to}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        color: "#1677ff",
        textDecoration: "none"
      }}
    >
      {ellipsis ? (
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
      )}
    </Link>
  );
}
