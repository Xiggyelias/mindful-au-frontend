import React, { Suspense } from "react";
import type { EmojiClickData, Theme as EmojiTheme } from "emoji-picker-react";
import { Loader2 } from "lucide-react";

const EmojiPicker = React.lazy(() => import("emoji-picker-react"));
const AUTO_THEME = "auto" as EmojiTheme;

type LazyEmojiPickerProps = {
  onEmojiClick: (emojiData: EmojiClickData) => void;
};

export const LazyEmojiPicker: React.FC<LazyEmojiPickerProps> = ({ onEmojiClick }) => (
  <Suspense
    fallback={
      <div className="flex h-[22rem] w-[21rem] items-center justify-center rounded-2xl border border-border/50 bg-background shadow-xl">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    }
  >
    <EmojiPicker onEmojiClick={onEmojiClick} theme={AUTO_THEME} lazyLoadEmojis />
  </Suspense>
);
