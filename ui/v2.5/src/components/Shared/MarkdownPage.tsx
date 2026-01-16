import React, { useEffect, useState } from "react";
import { Remark } from "react-remark";
import remarkGfm from "remark-gfm";

interface IPageProps {
  // page is a markdown module
  page: string;
}

export const MarkdownPage: React.FC<IPageProps> = ({ page }) => {
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    let isMounted = true;
    fetch(page)
      .then((res) => res.text())
      .then((text) => {
        if (isMounted) {
          setMarkdown(text);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [page]);

  return (
    <div className="markdown">
      <Remark remarkPlugins={[remarkGfm]}>{markdown}</Remark>
    </div>
  );
};
