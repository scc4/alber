-- Storage buckets: lounge-images, event-images (public) e split-photos (auth)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('lounge-images', 'lounge-images', true,  5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('event-images',  'event-images',  true,  5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('split-photos',  'split-photos',  false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- lounge-images
CREATE POLICY "lounge_images_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lounge-images');

CREATE POLICY "lounge_images_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'lounge-images');

-- event-images
CREATE POLICY "event_images_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "event_images_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-images');

-- split-photos (somente authenticated pode ler — spec SP-13)
CREATE POLICY "split_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'split-photos');

CREATE POLICY "split_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'split-photos');
