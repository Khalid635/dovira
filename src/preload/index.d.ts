import type { DoviraAPI } from './index.ts'

declare global {
  interface Window {
    dovira: DoviraAPI
  }
}
