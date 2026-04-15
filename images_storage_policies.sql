-- Remove the restrictive policy
DROP POLICY IF EXISTS "Give anon users access to JPG images in folder 1207hnn_1" ON storage.objects;

-- Create a proper open policy for your bucket
CREATE POLICY "Allow All Uploads" 
ON storage.objects 
FOR INSERT 
TO public 
WITH CHECK (bucket_id = 'watering-photos');

-- Ensure viewing is also open
CREATE POLICY "Allow Public Viewing" 
ON storage.objects 
FOR SELECT 
TO public 
USING (bucket_id = 'watering-photos');
