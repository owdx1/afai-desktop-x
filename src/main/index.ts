import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as dotenv from "dotenv"
import { OpenAIService } from './services/OpenAIService'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('process-file', async (_, args) => {
    try {
      const { fileData, userData } = args;
      
      const aiService = new OpenAIService("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");
      
      const processedBuffer = await aiService.processFileContent({
        name: fileData.name,
        type: fileData.type,
        buffer: fileData.buffer,
        clientMetadata: {
          name: userData.name,
          email: userData.email
        }
      });
      
      return {
        success: true,
        data: processedBuffer
      };
    } catch (error) {
      console.error("Error in process-file handler:", error);
      return {
        success: false,
        error: "Failed to process document"
      };
    }
  });

  dotenv.config()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
