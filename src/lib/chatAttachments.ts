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
  // PHP finfo reports WebM containers as video/webm regardless of audio-only content
  'video/webm',
]);

/** Strip codec parameters — e.g. "audio/webm;codecs=opus" → "audio/webm". */
const baseMime = (raw: string) => raw.split(';')[0].trim().toLowerCase();

export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_VOICE_NOTE_MAX_BYTES = 10 * 1024 * 1024;
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

  const normalised = baseMime(file.type);
  const extension =
    AUDIO_EXTENSION_BY_MIME[normalised] ||
    String(normalised.split('/')[1] || 'bin').replace(/[^a-zA-Z0-9]/g, '') ||
    'bin';
  const prefix = normalised.startsWith('audio/') || normalised === 'video/webm'
    ? 'voice_message'
    : 'attachment';
  const generatedName = `${prefix}_${Date.now()}.${extension}`;

  return new File([file], generatedName, {
    type: file.type || 'application/octet-stream',
  });
};

export const validateChatAttachment = (
  input: File,
  options?: { maxBytes?: number; maxLabel?: string }
): string | null => {
  const file = ensureAttachmentFile(input);
  const maxBytes = options?.maxBytes ?? CHAT_ATTACHMENT_MAX_BYTES;
  const maxLabel = options?.maxLabel ?? '5MB';

  if (file.size > maxBytes) {
    return `File size exceeds ${maxLabel} limit`;
  }

  const extension = String(file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return 'File type not supported. Allowed: JPG, PNG, GIF, PDF, DOCX, TXT, MP3, WAV, WEBM, OGG, M4A, AAC.';
  }

  const mimeType = baseMime(file.type || '');
  if (mimeType !== '' && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return 'File type not supported. Allowed: JPG, PNG, GIF, PDF, DOCX, TXT, MP3, WAV, WEBM, OGG, M4A, AAC.';
  }

  return null;
};

export const getAttachmentKind = (attachment?: ChatAttachment | null, messageType?: string): 'image' | 'audio' | 'document' | 'file' => {
  // message_type="voice" is canonical — always treat as audio regardless of server MIME
  if (messageType === 'voice') return 'audio';
  const mimeType = String(attachment?.file_type || '').toLowerCase();
  const fileName = String(attachment?.file_name || '').toLowerCase();
  const extension = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  if (mimeType.startsWith('image/')) return 'image';
  // audio/* covers normal cases; video/webm and *matroska* cover PHP finfo variants
  if (
    mimeType.startsWith('audio/') ||
    mimeType === 'video/webm' ||
    mimeType.includes('matroska')
  ) return 'audio';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'].includes(extension)) return 'audio';
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'text/plain'
  ) {
    return 'document';
  }
  return 'file';
};

/**
 * File/voice rows carry bytes on the server independent of E2EE text; show or download
 * attachments even when the message body is still awaiting a session key.
 */
export const messageIsAttachmentFirst = (message: {
  id: number;
  message_type?: string;
  has_file?: boolean;
  file_url?: string | null;
  attachment?: ChatAttachment | null;
  is_encrypted?: boolean;
  decryptedContent?: string;
  content?: string;
  e2eVisual?: string;
}): boolean => {
  const isFileMessage =
    message.message_type === 'file' || message.message_type === 'voice' || message.has_file;
  if (!isFileMessage) {
    return false;
  }
  const attachment = resolveMessageAttachment(message);
  if (attachment && (attachment.url || attachment.download_url || message.file_url)) {
    return true;
  }
  return Number.isInteger(message.id) && message.id > 0;
};

export const resolveMessageAttachment = (message: {
  attachment?: ChatAttachment | null;
  file_url?: string | null;
  message_type?: string;
  content?: string;
  decryptedContent?: string;
  is_encrypted?: boolean;
  e2eVisual?: string;
}): ChatAttachment | null => {
  if (message.attachment && typeof message.attachment === 'object') {
    return {
      ...message.attachment,
      url: message.attachment.url || message.file_url || null,
      download_url: message.attachment.download_url || message.attachment.url || message.file_url || null,
    };
  }

  if (
    message.is_encrypted &&
    !String(message.decryptedContent || '').trim()
  ) {
    if (message.message_type === 'file' || message.message_type === 'voice') {
      const url = message.file_url || null;
      if (!url) {
        return null;
      }
      return {
        file_name: message.message_type === 'voice' ? 'Voice note' : 'Attachment',
        file_type: message.message_type === 'voice' ? 'audio/webm' : 'application/octet-stream',
        file_size: 0,
        url,
        download_url: url,
      };
    }
    return null;
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
    const fileName = rawContent || (message.message_type === 'voice' ? 'Voice note' : 'Attachment');
    let fileType = message.message_type === 'voice' ? 'audio/webm' : 'application/octet-stream';
    
    if (message.message_type === 'file') {
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') fileType = 'image/jpeg';
      else if (ext === 'png') fileType = 'image/png';
      else if (ext === 'gif') fileType = 'image/gif';
      else if (ext === 'pdf') fileType = 'application/pdf';
    }

    return {
      file_name: fileName,
      file_type: fileType,
      file_size: 0,
      url,
      download_url: url,
    };
  }

  return null;
};
