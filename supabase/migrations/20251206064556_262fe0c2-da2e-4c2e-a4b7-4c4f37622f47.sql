-- Create storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', false);

-- Allow authenticated users to upload files to their own folder
CREATE POLICY "Users can upload their own attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to read files from sessions they're part of
CREATE POLICY "Users can read attachments from their sessions"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-attachments'
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id::text = (storage.foldername(name))[2]
    AND (s.student_id = auth.uid() OR s.counselor_id = auth.uid())
  )
);

-- Allow users to delete their own attachments
CREATE POLICY "Users can delete their own attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);