import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UploadResult {
  url: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface UseFileAttachmentProps {
  sessionId: string;
  userId: string;
  encryptionKey?: CryptoKey | null;
}

export const useFileAttachment = ({ sessionId, userId, encryptionKey: _encryptionKey }: UseFileAttachmentProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const resolveAudioExtension = (mimeType: string): string => {
    const extensionByMime: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
    };

    const mapped = extensionByMime[mimeType];
    if (mapped) {
      return mapped;
    }

    const fallback = mimeType.split('/')[1] || 'webm';
    return fallback.replace(/[^a-zA-Z0-9]/g, '') || 'webm';
  };

  const uploadFile = useCallback(async (file: File): Promise<UploadResult | null> => {
    if (!sessionId || !userId) {
      setError('Session not initialized');
      return null;
    }

    // Validate file size (max 8MB)
    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size exceeds 8MB limit');
      return null;
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3',
      'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/m4a'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      setError('File type not supported. Allowed: images, PDF, DOC, DOCX, TXT, audio files');
      return null;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      // Create file path: userId/sessionId/timestamp_filename
      const timestamp = Date.now();
      let fileName = file.name;
      
      // If it's a voice recording blob without proper name, generate one
      if (file.type.startsWith('audio/') && (!file.name || file.name === 'blob' || file.name.startsWith('blob'))) {
        const extension = resolveAudioExtension(file.type);
        fileName = `voice_message_${timestamp}.${extension}`;
      }
      
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${userId}/${sessionId}/${timestamp}_${sanitizedFileName}`;

      setUploadProgress(30);

      const { data, error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      setUploadProgress(80);

      // Get the public URL (or signed URL for private bucket)
      const { data: urlData } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days expiry

      if (!urlData?.signedUrl) {
        throw new Error('Failed to generate file URL');
      }

      setUploadProgress(100);

      return {
        url: urlData.signedUrl,
        fileName,
        fileType: file.type,
        fileSize: file.size
      };
    } catch (err) {
      console.error('File upload failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload file');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, userId]);

  const sendFileMessage = useCallback(async (
    file: File,
    sendMessage: (content: string, fileUrl?: string, messageType?: string) => Promise<boolean>
  ): Promise<boolean> => {
    const uploadResult = await uploadFile(file);
    
    if (!uploadResult) {
      return false;
    }

    // Create message content with file info
    const fileInfo = JSON.stringify({
      fileName: uploadResult.fileName,
      fileType: uploadResult.fileType,
      fileSize: uploadResult.fileSize,
      url: uploadResult.url
    });

    return await sendMessage(fileInfo, uploadResult.url, 'file');
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
