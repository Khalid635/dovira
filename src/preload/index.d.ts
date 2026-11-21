import { ElectronAPI } from '@electron-toolkit/preload'
import type { DoviraAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    dovira: DoviraAPI
  }
}
