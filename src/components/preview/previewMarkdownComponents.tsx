import type { Components } from "react-markdown";

export const previewMarkdownComponents: Components = {
  table({ node, ...props }) {
    void node;
    return (
      <div className="preview-markdown-table-wrap">
        <table {...props} />
      </div>
    );
  },
};
