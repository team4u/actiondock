import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownDescriptionProps {
  value?: string | null;
  emptyText?: string;
  className?: string;
}

function safeMarkdownUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const origin = typeof window === "undefined" ? "https://actiondock.local" : window.location.origin;
    const protocol = new URL(trimmed, origin).protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return trimmed;
    }
  } catch {
    return "";
  }

  return "";
}

export function MarkdownDescription({
  value,
  emptyText = "未填写描述",
  className
}: MarkdownDescriptionProps) {
  const markdown = value?.trim();
  const rootClassName = ["markdown-description", className].filter(Boolean).join(" ");

  if (!markdown) {
    return <div className={`${rootClassName} markdown-description--empty`}>{emptyText}</div>;
  }

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
