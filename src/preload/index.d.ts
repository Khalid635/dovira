import type { DoviraAPI } from './index'

declare global {
  interface Window {
    dovira: DoviraAPI
  }
}
