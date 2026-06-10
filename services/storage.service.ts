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
  return new Promise(resolve => {
    try {
      const rawExt      = localUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg'
      const mime        = rawExt === 'png'  ? 'image/png'
                        : rawExt === 'webp' ? 'image/webp'
                        :                    'image/jpeg'
      const ext         = mime === 'image/jpeg' ? 'jpg' : rawExt
      const storagePath = `${path}.${ext}`
      const url = bucket === 'split-photos'
        ? `${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${storagePath}`
        : `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`

      // Expo SDK 56 usa winter fetch que não suporta { uri, name, type } como FormDataPart.
      // XMLHttpRequest ainda usa a implementação nativa do RN e aceita esse padrão.
      const formData = new FormData()
      formData.append('file', { uri: localUri, name: `upload.${ext}`, type: mime } as unknown as Blob)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', ANON_KEY)
      xhr.setRequestHeader('x-upsert', 'true')

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(url)
        } else {
          console.error(`[storage] upload failed ${xhr.status} bucket=${bucket} path=${storagePath}`, xhr.responseText)
          resolve(null)
        }
      }
      xhr.onerror = () => {
        console.error(`[storage] upload network error bucket=${bucket} path=${storagePath}`)
        resolve(null)
      }

      xhr.send(formData)
    } catch (e) {
      console.error(`[storage] upload exception bucket=${bucket} path=${path}`, e)
      resolve(null)
    }
  })
}
