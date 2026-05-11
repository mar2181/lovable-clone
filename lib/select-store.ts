import { create } from "zustand";
import { nanoid } from "nanoid";

export type Selection = {
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
};

type SelectStore = {
  isModeActive: boolean;
  current: Selection | null;
  setModeActive: (v: boolean) => void;
  setSelection: (s: Selection | null) => void;
  clear: () => void;
  exit: () => void;
};

export const useSelectStore = create<SelectStore>((set) => ({
  isModeActive: false,
  current: null,
  setModeActive: (v: boolean) => set({ isModeActive: v }),
  setSelection: (s: Selection | null) => set({ current: s }),
  clear: () => set({ current: null }),
  exit: () => set({ isModeActive: false, current: null }),
}));

export function makeSelection(
  payload: Omit<Selection, "id" | "capturedAt">,
): Selection {
  return { id: nanoid(8), ...payload, capturedAt: Date.now() };
}
