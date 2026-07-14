import { create } from 'zustand';
import type { Message } from '@/types/message';

interface ChatState {
  messages: Message[];
  addMessage: (m: Message) => void;
  updateLast: (patch: Partial<Message>) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateLast: (patch) =>
    set((s) => {
      if (s.messages.length === 0) return s;
      const last = s.messages[s.messages.length - 1];
      return {
        messages: [...s.messages.slice(0, -1), { ...last, ...patch }],
      };
    }),
  clear: () => set({ messages: [] }),
}));
