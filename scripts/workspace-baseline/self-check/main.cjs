// Minimal Electron entry used only by `workspace-baseline --self-check`.
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    useContentSize: true,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  void window.loadFile(path.join(__dirname, 'measure-page.html'))
})

app.on('window-all-closed', () => app.quit())
