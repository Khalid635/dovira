import type { DownloadInfo } from '../types'

export type Category =
  'Video' | 'Music' | 'Documents' | 'Archives' | 'Programs' | 'Images' | 'Others'

const EXTENSION_MAP: Record<string, Category> = {
  mp4: 'Video',
  mkv: 'Video',
  webm: 'Video',
  mov: 'Video',
  avi: 'Video',
  mp3: 'Music',
  m4a: 'Music',
  flac: 'Music',
  wav: 'Music',
  opus: 'Music',
  ogg: 'Music',
  pdf: 'Documents',
  doc: 'Documents',
  docx: 'Documents',
  txt: 'Documents',
  md: 'Documents',
  epub: 'Documents',
  xls: 'Documents',
  xlsx: 'Documents',
  ppt: 'Documents',
  pptx: 'Documents',
  zip: 'Archives',
  rar: 'Archives',
  '7z': 'Archives',
  tar: 'Archives',
  gz: 'Archives',
  exe: 'Programs',
  msi: 'Programs',
  apk: 'Programs',
  dmg: 'Programs',
  iso: 'Programs',
  jpg: 'Images',
  jpeg: 'Images',
  png: 'Images',
  gif: 'Images',
  webp: 'Images',
  svg: 'Images',
  bmp: 'Images'
}

/**
 * Rule-based categorization (extension only). The interface is the contract:
 * Phase 7 may swap the inside for metadata / a local model without touching
 * callers (§2 AI-ready architecture).
 */
export function categorize(download: Pick<DownloadInfo, 'filename'>): Category {
  const ext = download.filename.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MAP[ext] ?? 'Others'
}
