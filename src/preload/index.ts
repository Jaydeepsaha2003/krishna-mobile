import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: { message: string; code: string }
}

const api = {
  /** Single typed door into the main process. Returns `{ ok, data | error }`. */
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<ApiResult<T>> {
    return ipcRenderer.invoke('api', channel, payload)
  },

  on(channel: string, listener: (...args: any[]) => void): () => void {
    const wrapped = (_e: IpcRendererEvent, ...args: any[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  once(channel: string, listener: (...args: any[]) => void): void {
    ipcRenderer.once(channel, (_e, ...args) => listener(...args))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
