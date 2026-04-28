export interface ChatAttachment {
  id?: number;
  message_id?: number;
  file_name: string;
  file_path?: string;
  file_type: string;
  file_size: number;
  uploaded_at?: string | null;
  url?: string | null;
  download_url?: string | null;
}

const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/m4a': 'm4a',
};

const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'pdf',
  'docx',
  'txt',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'm4a',
  'aac',
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/m4a',
]);

export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/gif,.pdf,.docx,.txt,.mp3,.wav,.webm,.ogg,.m4a,.aac';

export const formatChatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const inferAttachmentMessageType = (file: File): 'file' | 'voice' => {
  return file.type.startsWith('audio/') ? 'voice' : 'file';
};

export const ensureAttachmentFile = (input: File): File => {
  const file = input;
  const trimmedName = String(file.name || '').trim();
  if (trimmedName !== '' && trimmedName.toLowerCase() !== 'blob') {
    return file;
  }

  const extension =
    AUDIO_EXTENSION_BY_MIME[file.type] ||
    String(file.type.split('/')[1] || 'bin').replace(/[^a-zA-Z0-9]/g, '') ||
    'bin';
  const prefix = file.type.startsWith('audio/') ? 'voice_message' : 'attachment';
  const generatedName = `${prefix}_${Date.now()}.${extension}`;

  return new File([file], generatedName, {
    type: file.type || 'application/octet-stream',
  });
};

export const validateChatAttachment = (input: File): string | null => {
  const file = ensureAttachmentFile(input);

  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return 'File size exceeds 5MB limit';
  }

  const extension = String(file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return 'File type not supported. Allowed: JPG, PNG, GIF, PDF, DOCX, TXT, MP3, WAV.';
  }

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType !== '' && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return 'File type not supported. Allowed: JPG, PNG, GIF, PDF, DOCX, TXT, MP3, WAV.';
  }

  return null;
};

export const getAttachmentKind = (attachment?: ChatAttachment | null): 'image' | 'audio' | 'document' | 'file' => {
  const mimeType = String(attachment?.file_type || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'text/plain'
  ) {
    return 'document';
  }
  return 'file';
};

export const resolveMessageAttachment = (message: {
  attachment?: ChatAttachment | null;
  file_url?: string | null;
  message_type?: string;
  content?: string;
  decryptedContent?: string;
}): ChatAttachment | null => {
  if (message.attachment && typeof message.attachment === 'object') {
    return {
      ...message.attachment,
      url: message.attachment.url || message.file_url || null,
      download_url: message.attachment.download_url || message.attachment.url || message.file_url || null,
    };
  }

  const rawContent = String(message.decryptedContent || message.content || '').trim();
  if (rawContent.startsWith('{')) {
    try {
      const legacy = JSON.parse(rawContent) as {
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        url?: string;
      };

      const url = legacy.url || message.file_url || null;
      return {
        file_name: legacy.fileName || 'Attachment',
        file_type: legacy.fileType || 'application/octet-stream',
        file_size: Number(legacy.fileSize || 0),
        url,
        download_url: url,
      };
    } catch {
      // fall through to plain fallback
    }
  }

  if (message.message_type === 'file' || message.message_type === 'voice') {
    const url = message.file_url || null;
    return {
      file_name: rawContent || (message.message_type === 'voice' ? 'Voice note' : 'Attachment'),
      file_type: message.message_type === 'voice' ? 'audio/webm' : 'application/octet-stream',
      file_size: 0,
      url,
      download_url: url,
    };
  }

  return null;
};
