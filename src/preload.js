const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('switchConsole', {
  connect: (profile) => ipcRenderer.invoke('session:connect', profile),
  write: (sessionId, data) => ipcRenderer.invoke('session:write', { sessionId, data }),
  resize: (sessionId, cols, rows) => ipcRenderer.invoke('session:resize', { sessionId, cols, rows }),
  disconnect: (sessionId) => ipcRenderer.invoke('session:disconnect', sessionId),
  saveConfig: (payload) => ipcRenderer.invoke('dialog:save-config', payload),
  loadInventory: () => ipcRenderer.invoke('inventory:load'),
  saveProfile: (profile) => ipcRenderer.invoke('inventory:save-profile', profile),
  deleteProfile: (profileId) => ipcRenderer.invoke('inventory:delete-profile', profileId),
  importInventory: () => ipcRenderer.invoke('inventory:import'),
  exportInventory: (format) => ipcRenderer.invoke('inventory:export', { format }),
  backupProfile: (profile) => ipcRenderer.invoke('backup:profile', profile),
  onData: (callback) => {
    ipcRenderer.on('session:data', (_event, payload) => callback(payload));
  },
  onStatus: (callback) => {
    ipcRenderer.on('session:status', (_event, payload) => callback(payload));
  },
  onBackupProgress: (callback) => {
    ipcRenderer.on('backup:progress', (_event, payload) => callback(payload));
  }
});
