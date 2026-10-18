export type AvatarStyle =
  | "dino-green"
  | "dino-blue"
  | "dino-red"
  | "fox-amber"
  | "owl-violet"
  | "panda-emerald";

export interface LoungeParticipant {
  id: string;
  name: string;
  role: string;
  avatar: AvatarStyle;
  x: number;
  y: number;
  isTalking: boolean;
  isMuted: boolean;
  isLocal?: boolean;
  speechText?: string;
  speechExpiry?: number;
  reactionEmoji?: string;
  reactionExpiry?: number;
}

export interface LoungeChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  avatar: AvatarStyle;
  text: string;
  timestamp: string;
  isLocal?: boolean;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
  y: number;
  createdAt: number;
}
