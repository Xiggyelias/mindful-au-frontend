import { useState, useCallback } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import {
  ensureAttachmentFile,
  inferAttachmentMessageType,
  validateChatAttachment,
} from '@/lib/chatAttachments';
import type { ChatMessage } from '@/hooks/useEncryptedChat';

interface UseFileAttachmentProps {
  sessionId: string;
}

export const useFileAttachment = ({ sessionId }: UseFileAttachmentProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(async (
    input: File,
    options?: { messageType?: 'file' | 'voice' }
  ): Promise<ChatMessage | null> => {
    if (!sessionId) {
      setError('Session not initialized');
      return null;
    }

    const normalizedFile = ensureAttachmentFile(input);
    const validationError = validateChatAttachment(normalizedFile);
    if (validationError) {
      setError(validationError);
      return null;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const message = await api.uploadChatFile(sessionId, normalizedFile, {
        message_type: options?.messageType ?? inferAttachmentMessageType(normalizedFile),
        onUploadProgress: (progress) => {
          setUploadProgress(progress);
        },
      });

      setUploadProgress(100);
      return message as ChatMessage;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Chat attachment upload failed:', err);
      }
      setError(getApiErrorMessage(err, 'Failed to upload file'));
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [sessionId]);

  const sendFileMessage = useCallback(async (
    file: File,
    options?: { messageType?: 'file' | 'voice' }
  ): Promise<ChatMessage | null> => {
    return uploadFile(file, options);
  }, [uploadFile]);

  return {
    uploadFile,
    sendFileMessage,
    isUploading,
    uploadProgress,
    error,
    clearError: () => setError(null)
  };
};
