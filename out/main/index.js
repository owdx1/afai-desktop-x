"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const dotenv = require("dotenv");
const docx = require("docx");
const mammoth = require("mammoth");
const Groq = require("groq-sdk");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const dotenv__namespace = /* @__PURE__ */ _interopNamespaceDefault(dotenv);
const mammoth__namespace = /* @__PURE__ */ _interopNamespaceDefault(mammoth);
const icon = path.join(__dirname, "../../resources/icon.png");
class OpenAIService {
  groq;
  constructor(qroqKey) {
    if (qroqKey === "") console.log("API key not provided");
    this.groq = new Groq({ apiKey: qroqKey });
  }
  async processFileContent(fileData) {
    try {
      const text = await this.extractTextFromDocx(fileData.buffer);
      const resp = await this.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Fill the fields according to this info: ${fileData.clientMetadata.name} - ${fileData.clientMetadata.email} Field There are empty fields in this docx form. Fill the empty fields and return the form as a whole. ONLY fill empty blanks. DO NOT add your expressions. For example, DO NOT ADD "Here is the form" text on top of the RESPONSE. DO NOT ADD ANY ADDITIONAL CONTENT`
          },
          {
            role: "user",
            content: `Document Content:

${text}`
          }
        ],
        model: "llama3-70b-8192"
      });
      const resultText = resp.choices[0].message.content || "No content received.";
      return await this.generateDocx(resultText);
    } catch (error) {
      console.error("Error processing file:", error);
      throw error;
    }
  }
  async extractTextFromDocx(buffer) {
    const result = await mammoth__namespace.extractRawText({ buffer });
    return result.value;
  }
  async generateDocx(text) {
    const doc = new docx.Document({
      sections: [{
        children: [new docx.Paragraph(text)]
      }]
    });
    return await docx.Packer.toBuffer(doc);
  }
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.ipcMain.handle("process-file", async (_, args) => {
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
  dotenv__namespace.config();
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
