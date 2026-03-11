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
