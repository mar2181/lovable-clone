export interface SelectionPayload {
  id: string;
  tag: string;
  text: string;
  selectorPath: string;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  outerHTML: string;
  ancestorContext: string;
  bbox: { x: number; y: number; width: number; height: number };
  capturedAt: number;
}
