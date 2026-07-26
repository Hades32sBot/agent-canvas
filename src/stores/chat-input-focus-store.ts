import { create } from "zustand";

interface ChatInputFocusState {
  isFocused: boolean;
  setFocused: (focused: boolean) => void;
}

export const useChatInputFocusStore = create<ChatInputFocusState>((set) => ({
  isFocused: false,
  setFocused: (focused) => set({ isFocused: focused }),
}));
