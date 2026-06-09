// Spec: /specs/06_modules/split.md §11.1 (câmera), /specs/06_modules/alber_lounge.md §4,§9
// Upload via Supabase Storage REST API — sem supabase-js

import * as ImagePicker from 'expo-image-picker'

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON_KEY    = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

export type StorageBucket = 'lounge-images' | 'event-images' | 'split-photos'

// ── Pickers ──────────────────────────────────────────────────────────────────

export async function pickFromCamera(): Promise<string | null> {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync()
  if (!granted) return null
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality: 0.8,
    allowsEditing: false,
  })
  return result.canceled ? null : result.assets[0].uri
}

export async function pickFromGallery(): Promise<string | null> {
  const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!granted) return null
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 0.8,
    allowsEditing: false,
  })
  return result.canceled ? null : result.assets[0].uri
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadImage(
  localUri: string,
  bucket: StorageBucket,
  path: string,
  token: string,
): Promise<string | null> {
  try {
    const rawExt     = localUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg'
    const mime       = rawExt === 'png'  ? 'image/png'
                     : rawExt === 'webp' ? 'image/webp'
                     :                    'image/jpeg'
    const ext        = mime === 'image/jpeg' ? 'jpg' : rawExt
    const storagePath = `${path}.${ext}`

    const blob = await fetch(localUri).then(r => r.blob())

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        apikey:         ANON_KEY,
        'Content-Type': mime,
        'x-upsert':     'true',
      },
      body: blob,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      console.error(`[storage] upload failed ${res.status} bucket=${bucket} path=${storagePath}`, errBody)
      return null
    }

    if (bucket === 'split-photos') {
      return `${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${storagePath}`
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`
  } catch (e) {
    console.error(`[storage] upload exception bucket=${bucket} path=${storagePath}`, e)
    return null
  }
}
