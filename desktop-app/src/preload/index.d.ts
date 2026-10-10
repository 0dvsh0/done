import type { DoneApi } from '../shared/types'
import type { DoneSystem } from './index'

declare global {
  interface Window {
    done: DoneApi
    system: DoneSystem
  }
}

export {}
