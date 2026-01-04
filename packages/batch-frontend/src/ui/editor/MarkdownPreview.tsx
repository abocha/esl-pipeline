import React, { useEffect, useState } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

const processor = unified().use(remarkParse).use(remarkRehype).use(rehypeStringify);

interface MarkdownPreviewProps {
  value: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ value }) => {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const renderPreview = async () => {
      try {
        const file = await processor.process(value || '');
        if (!active) return;
        setHtml(String(file));
        setError(null);
      } catch (error_) {
        if (!active) return;
        const message = error_ instanceof Error ? error_.message : 'Unable to render preview';
        setError(message);
      }
    };
    void renderPreview();
    return () => {
      active = false;
    };
  }, [value]);

  if (error) {
    return <p className="error-text">{error}</p>;
  }

  if (!value.trim()) {
    return <p className="muted">Draft preview will appear here.</p>;
  }

  return (
    <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
  );
};
