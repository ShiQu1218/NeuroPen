export interface PreviewImageAttachment {
  kind: "image";
  name: string;
  mimeType: string;
  base64Data: string;
  source: "file" | "screenshot";
}

export interface PreviewTextAttachment {
  kind: "text";
  name: string;
  mimeType: string;
  textContent: string;
  truncated: boolean;
  source: "file";
}

export type PreviewAttachment = PreviewImageAttachment | PreviewTextAttachment;

export const MAX_ATTACHMENT_CONTEXT_CHARS = 24_000;
export const DEFAULT_RETAINED_DOCUMENT_INSTRUCTION =
  "Use the attached document content as reference together with the selected text. Answer directly if the selected text is a question; otherwise provide the most relevant response based on the document.";

export function resolveRetainedDocumentInstruction(instruction: string | null | undefined) {
  return instruction?.trim() || DEFAULT_RETAINED_DOCUMENT_INSTRUCTION;
}

export function buildAttachmentInstruction(
  input: string,
  selectedText: string,
  attachments: PreviewAttachment[],
) {
  // Flatten preview attachments into one LLM instruction so provider calls can
  // stay stateless while still carrying bounded document context.
  if (attachments.length === 0) {
    return input;
  }
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const textAttachments = attachments.filter((attachment) => attachment.kind === "text");
  const sections: string[] = [];

  if (selectedText.trim()) {
    sections.push(`Selected text for context:\n${selectedText}`);
  }

  if (imageAttachments.length > 0) {
    sections.push(`Attached images (${imageAttachments.length}):\n${imageAttachments.map((attachment, index) => `${index + 1}. ${attachment.name}`).join("\n")}`);
  }

  if (textAttachments.length > 0) {
    let remainingChars = MAX_ATTACHMENT_CONTEXT_CHARS;
    const renderedTextAttachments = textAttachments
      .map((attachment, index) => {
        const content = attachment.textContent.slice(0, remainingChars);
        remainingChars = Math.max(0, remainingChars - content.length);
        const truncated = attachment.truncated || content.length < attachment.textContent.length;
        return [
          `Document ${index + 1}: ${attachment.name}`,
          `Type: ${attachment.mimeType}`,
          "Content:",
          '"""',
          content,
          '"""',
          truncated ? "Note: This document was truncated to fit within the chat context." : "",
        ]
          .filter((part) => part !== "")
          .join("\n");
      })
      .join("\n\n");
    sections.push(`Attached documents:\n${renderedTextAttachments}`);
  }

  sections.push(`User request:\n${input}`);
  return sections.join("\n\n");
}
