import { useState, useCallback, useEffect } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import { uploadManager } from '@/lib/uploadManager';
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
    file: File,
    options?: { messageType?: 'file' | 'voice' }
  ): Promise<ChatMessage | null> => {
    if (!sessionId) {
      setError('Session not initialized');
      return null;
    }

    const baseFile = ensureAttachmentFile(file);
    const normalizedFile =
      options?.messageType === "voice" &&
      (!baseFile.type || !baseFile.type.toLowerCase().startsWith("audio/"))
        ? new File([baseFile], baseFile.name.replace(/\.[^/.]+$/, "") + ".webm", {
            type: "audio/webm",
          })
        : baseFile;
    const validationError = validateChatAttachment(normalizedFile);
    if (validationError) {
      setError(validationError);
      return null;
    }

    const uploadId = `upload-${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const message = await uploadManager.enqueue(uploadId, normalizedFile, async (uploadFile, onProgress) => {
        return await api.uploadChatFile(sessionId, uploadFile, {
          message_type: options?.messageType ?? inferAttachmentMessageType(uploadFile),
          onUploadProgress: onProgress,
        });
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
      // Clean up completed upload after a delay
      setTimeout(() => uploadManager.cleanup(uploadId), 5000);
    }
  }, [sessionId]);

  // Poll upload progress for UI updates when component is mounted
  useEffect(() => {
    if (!isUploading) return;

    const interval = setInterval(() => {
      // Find any active upload for this session
      const activeUploads = Array.from(uploadManager.getUploads().entries())
        .filter(([id]) => id.includes(`upload-${sessionId}`));
      
      if (activeUploads.length > 0) {
        const [_, entry] = activeUploads[0];
        setUploadProgress(entry.progress);
        
        if (entry.status === 'complete' || entry.status === 'error') {
          setIsUploading(false);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isUploading, sessionId]);

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
