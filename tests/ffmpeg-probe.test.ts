import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseFfmpegProbe } from '../src/main/engines/ytdlp.ts'

const VIDEO_ONLY = `ffmpeg version 9.0.2 Copyright (c) 2000-2025 the FFmpeg developers
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:01:30.50, start: 0.000000, bitrate: 1560 kb/s
  Stream #0:0(und): Video: av1 (Main) (av01 / 0x31307661), yuv420p(tv), 1920x1080, 1560 kb/s, 30 fps
`

const BOTH = `Input #0, matroska,webm, from 'movie.mkv':
  Duration: 02:00:00.00, start: 0.000000, bitrate: 4000 kb/s
  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 25 fps
  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s
`

const AUDIO_ONLY = `Input #0, mp3, from 'song.mp3':
  Duration: 00:03:45.25, start: 0.000000, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
`

describe('ffmpeg probe (next-level, replaces ffprobe)', () => {
  it('video-only file: hasVideo, no audio, duration parsed', () => {
    assert.deepEqual(parseFfmpegProbe(VIDEO_ONLY), {
      hasVideo: true,
      hasAudio: false,
      duration: 90.5
    })
  })

  it('both streams + 2h duration', () => {
    assert.deepEqual(parseFfmpegProbe(BOTH), {
      hasVideo: true,
      hasAudio: true,
      duration: 7200
    })
  })

  it('audio-only file', () => {
    assert.deepEqual(parseFfmpegProbe(AUDIO_ONLY), {
      hasVideo: false,
      hasAudio: true,
      duration: 225.25
    })
  })

  it('garbage output -> nothing found, null duration', () => {
    assert.deepEqual(parseFfmpegProbe('not ffmpeg output at all\n'), {
      hasVideo: false,
      hasAudio: false,
      duration: null
    })
  })

  it('Duration: N/A -> null duration, streams still detected', () => {
    assert.deepEqual(
      parseFfmpegProbe(
        'Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: h264, yuv420p, 640x360\n'
      ),
      { hasVideo: true, hasAudio: false, duration: null }
    )
  })
})
