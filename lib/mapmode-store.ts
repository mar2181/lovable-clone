import { create } from "zustand";
import { useSelectStore } from "@/lib/select-store";

// Map Mode — numbered command navigation (see docs/SOP_MAP_MODE.md).
// Numbers + a few fixed verbs drive the live preview with no LLM round-trip.
// The preview iframe owns the DOM, so it does the numbering/acting and reports
// back; this store is the shared state between PreviewPanel (which talks to the
// iframe) and MapModeController (the HUD + voice + command parser).

export type Mark = {
  num: number;
  tag: string;
  name: string;
  typeable: boolean;
  bbox: { x: number; y: number; width: number; height: number };
};

export type Acted = { num: number | null; label: string; execMs: number; at: number };

type Sender = (type: string, payload?: unknown) => void;

type MapModeStore = {
  isMapMode: boolean;
  marks: Mark[];           // PREVIEW (iframe) elements only
  previewOffset: number;   // chrome element count — preview numbers start after this
  focusedNum: number | null;
  dictating: boolean;
  lastActed: Acted | null;
  _send: Sender | null;

  setSender: (fn: Sender) => void;
  setMapMode: (v: boolean) => void;
  toggle: () => void;
  setMarks: (m: Mark[]) => void;
  setPreviewOffset: (n: number) => void;
  /** Record which element is focused and whether we're dictating into it. */
  setFocus: (num: number | null, dictating: boolean) => void;
  /** Send a command to the preview iframe runtime. */
  act: (payload: { kind: string; num?: number; text?: string }) => void;
  pushActed: (a: Omit<Acted, "at">) => void;
};

export const useMapModeStore = create<MapModeStore>((set, get) => ({
  isMapMode: false,
  marks: [],
  previewOffset: 0,
  focusedNum: null,
  dictating: false,
  lastActed: null,
  _send: null,

  setSender: (fn) => set({ _send: fn }),
  setPreviewOffset: (n) => set({ previewOffset: n }),

  setMapMode: (v) => {
    // Map mode and Select mode both intercept the preview — never both at once.
    if (v) {
      try {
        useSelectStore.getState().setModeActive(false);
      } catch {
        /* select store optional */
      }
    }
    // Leaving map mode resets focus/dictation centrally (covers every exit path).
    set({ isMapMode: v, marks: v ? get().marks : [], focusedNum: null, dictating: false });
  },

  toggle: () => get().setMapMode(!get().isMapMode),

  setMarks: (m) => set({ marks: m }),

  setFocus: (num, dictating) => set({ focusedNum: num, dictating }),

  act: (payload) => {
    const send = get()._send;
    if (send) send("mapmode-act", payload);
  },

  pushActed: (a) => set({ lastActed: { ...a, at: Date.now() } }),
}));
