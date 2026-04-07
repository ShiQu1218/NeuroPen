declare module "katex/contrib/auto-render" {
  interface AutoRenderDelimiter {
    left: string;
    right: string;
    display: boolean;
  }

  interface AutoRenderOptions {
    delimiters?: AutoRenderDelimiter[];
    errorCallback?: (message: string, error: unknown) => void;
    ignoredClasses?: string[];
    ignoredTags?: string[];
    preProcess?: (math: string) => string;
  }

  export default function renderMathInElement(
    element: HTMLElement,
    options?: AutoRenderOptions,
  ): void;
}
