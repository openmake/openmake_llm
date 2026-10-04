// 설정 창 ↔ 메인 프로세스 — 정해진 두 호출만 노출한다(임의 IPC·Node API 를 화면에 주지 않는다).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
});
