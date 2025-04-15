"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const dotenv = require("dotenv");
const mammoth = require("mammoth");
const OpenAI = require("openai");
const buffer = require("buffer");
const pdfParse = require("pdf-parse");
const pdfLib = require("pdf-lib");
const fs = require("fs");
const fontkit = require("fontkit");
const axios = require("axios");
const child_process = require("child_process");
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
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const dotenv__namespace = /* @__PURE__ */ _interopNamespaceDefault(dotenv);
const mammoth__namespace = /* @__PURE__ */ _interopNamespaceDefault(mammoth);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const icon = path.join(__dirname, "../../resources/icon.png");
class OpenAIService {
  openai;
  apiKey;
  apiType;
  TURKISH_CHARS_MAP = {
    // Special characters
    "i̇": "i",
    // Dotted i
    "iı": "ı",
    // Dotless i
    "ğ": "ğ",
    // g with breve
    "ü": "ü",
    // u with diaeresis
    "ş": "ş",
    // s with cedilla
    "ö": "ö",
    // o with diaeresis
    "ç": "ç",
    // c with cedilla
    // Broken characters
    "g˘": "ğ",
    "u¨": "ü",
    "o¨": "ö",
    "s¸": "ş",
    "c¸": "ç",
    // Split characters
    "i ̇": "i",
    "g ̆": "ğ",
    "u ̈": "ü",
    "o ̈": "ö",
    "s ̧": "ş",
    "c ̧": "ç"
  };
  constructor(apiKey) {
    this.apiKey = apiKey;
    if (apiKey.startsWith("sk-ant-")) {
      this.apiType = "anthropic";
      console.log("Using Anthropic Claude API");
    } else if (apiKey.startsWith("sk-o-")) {
      this.apiType = "openai";
      console.log("Using OpenAI API");
    } else if (apiKey.startsWith("gsk_")) {
      this.apiType = "groq";
      console.log("Using Groq API");
    } else {
      this.apiType = "openai";
      console.log("Using default OpenAI API");
    }
    if (apiKey === "") {
      console.log("API key not provided");
    }
    this.openai = new OpenAI({ apiKey: this.apiType === "openai" ? apiKey : "dummy-key" });
  }
  normalizeText(text) {
    let normalized = text.normalize("NFC");
    Object.entries(this.TURKISH_CHARS_MAP).forEach(([incorrect, correct]) => {
      normalized = normalized.replace(new RegExp(incorrect, "g"), correct);
    });
    normalized = normalized.replace(/─░/g, "İ").replace(/─ş/g, "ş").replace(/─▒/g, "ı").replace(/─ğ/g, "ğ").replace(/─ü/g, "ü").replace(/─ö/g, "ö").replace(/─ç/g, "ç").replace(/([A-Za-z])\s+([A-Za-z])/g, "$1$2").replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2").replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, "$1$2").replace(/([A-Za-z])\s+([ğüşıöçĞÜŞİÖÇ])/g, "$1$2").replace(/([ğüşıöçĞÜŞİÖÇ])\s+([A-Za-z])/g, "$1$2").replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, "$1$2").replace(/([A-Za-zğüşıöçĞÜŞİÖÇ])\s*-\s*\n\s*([A-Za-zğüşıöçĞÜŞİÖÇ])/g, "$1$2");
    return normalized;
  }
  async processFileContent(fileData) {
    try {
      const text = await this.extractTextFromDocument(fileData.buffer, fileData.type);
      const base64File = fileData.buffer.toString("base64");
      console.log(`Processing file with ${this.apiType} vision capabilities`);
      try {
        let formFields = [];
        if (this.apiType === "anthropic") {
          console.log("Attempting to use Claude API with key starting with:", this.apiKey.substring(0, 7) + "...");
          const response = await axios.post(
            "https://api.anthropic.com/v1/messages",
            {
              model: "claude-3-opus-20240229",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Analyze this Turkish form PDF and return ONLY a JSON array containing form fields with their PRECISE positions. 

Form field format:
{
  "name": "field name in Turkish",
  "value": "current value or empty",
  "x": horizontal position in points from left,
  "y": vertical position in points from top,
  "width": width in points,
  "height": height in points
}

Pay special attention to:
1. Position fields EXACTLY where form fields appear in the document
2. Track coordinate origin (0,0) from top-left of the page
3. Return data as VALID JSON array only

Return ALL form fields visible in the document, especially address fields.`
                    },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: fileData.type,
                        data: base64File
                      }
                    }
                  ]
                }
              ]
            },
            {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.apiKey,
                "anthropic-version": "2023-06-01"
              }
            }
          ).catch((error) => {
            console.error("Claude API error details:", error.response?.data || error.message);
            throw new Error(`Claude API error: ${error.message}`);
          });
          if (!response.data || !response.data.content || !response.data.content[0] || !response.data.content[0].text) {
            console.error("Unexpected Claude API response structure:", JSON.stringify(response.data));
            throw new Error("Invalid Claude API response structure");
          }
          console.log("Claude Response received successfully");
          const claudeText = response.data.content[0].text;
          console.log("Claude Response:", claudeText.substring(0, 200) + "...");
          try {
            const content = claudeText || "[]";
            console.log("Content length:", content.length);
            const cleanJson = content.replace(/```json\s*/g, "").replace(/```\s*$/g, "").replace(/[\u0000-\u001F]+/g, "").trim();
            console.log("Cleaned JSON length:", cleanJson.length);
            const match = cleanJson.match(/\[.*\]/s);
            if (match) {
              console.log("Found JSON array match of length:", match[0].length);
              formFields = JSON.parse(match[0]);
              console.log("Parsed fields count:", formFields.length);
            } else {
              console.log("No JSON array pattern found in response");
              throw new Error("No valid JSON array in response");
            }
          } catch (parseError) {
            console.error("Error parsing Claude response:", parseError);
            throw parseError;
          }
        } else if (this.apiType === "openai") {
          console.log("Using OpenAI GPT-4 Vision");
          const response = await this.openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Analyze this Turkish form PDF and return ONLY a JSON array containing form fields with their PRECISE positions.`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${fileData.type};base64,${base64File}`
                    }
                  }
                ]
              }
            ]
          });
          const content = response.choices[0].message.content || "[]";
          console.log("GPT-4 Vision raw content:", content);
          try {
            const match = content.match(/\[.*\]/s);
            if (match) {
              formFields = JSON.parse(match[0]);
            } else {
              throw new Error("No JSON array in GPT-4 Vision response");
            }
          } catch (parseError) {
            console.error("Error parsing GPT-4 Vision response:", parseError);
            throw parseError;
          }
        } else {
          console.log("Using Groq API");
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama3-70b-8192",
              messages: [
                {
                  role: "user",
                  content: `Here is the form content. Please extract the exact field positions and return only a JSON array:
  
${text}
  
Return the exact field positions matching the form layout.`
                }
              ],
              temperature: 0.1
            },
            {
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
              }
            }
          );
          const content = response.data.choices[0].message.content || "[]";
          try {
            const match = content.match(/\[.*\]/s);
            if (match) {
              formFields = JSON.parse(match[0]);
            } else {
              throw new Error("No JSON array in Groq response");
            }
          } catch (parseError) {
            console.error("Error parsing Groq response:", parseError);
            throw parseError;
          }
        }
        if (!formFields || formFields.length < 4) {
          throw new Error("Insufficient form fields detected");
        }
        formFields = this.mergeUserDataWithFormFields(formFields, fileData.userData);
        return await this.modifyOriginalPDF(fileData.buffer, formFields);
      } catch (visionError) {
        console.error("Vision API error:", visionError);
        console.log("Falling back to default form field values");
        const formFields = [
          { name: "Tarih", value: (/* @__PURE__ */ new Date()).toLocaleDateString("tr-TR"), x: 500, y: 200, width: 150, height: 20 },
          { name: "İsim", value: this.extractFirstName(fileData.userData.name) || "", x: 100, y: 270, width: 200, height: 30 },
          { name: "Soyisim", value: this.extractLastName(fileData.userData.name) || "", x: 400, y: 270, width: 300, height: 30 },
          { name: "E-Mail", value: fileData.userData.email || "", x: 100, y: 375, width: 600, height: 30 },
          { name: "Adres", value: fileData.userData.address || "", x: 100, y: 510, width: 600, height: 30 }
        ];
        return await this.modifyOriginalPDF(fileData.buffer, formFields);
      }
    } catch (error) {
      console.error("Error processing file:", error);
      throw error;
    }
  }
  extractLastName(fullName) {
    if (!fullName) return null;
    const nameParts = fullName.trim().split(" ");
    return nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
  }
  extractFirstName(fullName) {
    if (!fullName) return null;
    const nameParts = fullName.trim().split(" ");
    if (nameParts.length <= 1) return fullName;
    return nameParts.slice(0, -1).join(" ");
  }
  mergeUserDataWithFormFields(formFields, userData) {
    return formFields.map((field) => {
      const lowerFieldName = field.name.toLowerCase();
      if ((lowerFieldName.includes("isim") || lowerFieldName.includes("ad")) && !lowerFieldName.includes("soy")) {
        field.value = this.extractFirstName(userData.name) || field.value;
      } else if (lowerFieldName.includes("soyisim") || lowerFieldName.includes("soyad")) {
        field.value = this.extractLastName(userData.name) || field.value;
      } else if (lowerFieldName.includes("e-mail") || lowerFieldName.includes("email")) {
        field.value = userData.email || field.value;
      } else if (lowerFieldName.includes("adres")) {
        field.value = userData.address || field.value;
      } else if (lowerFieldName.includes("tarih")) {
        field.value = (/* @__PURE__ */ new Date()).toLocaleDateString("tr-TR");
      }
      return field;
    });
  }
  async extractTextFromDocument(buffer2, type) {
    let extractedText = "";
    if (type.includes("docx")) {
      const result = await mammoth__namespace.extractRawText({ buffer: buffer2 });
      extractedText = result.value;
    } else if (type.includes("pdf")) {
      try {
        const pdfData = await pdfParse(buffer2);
        extractedText = pdfData.text;
        console.log("Extracted PDF text:", extractedText);
      } catch (pdfError) {
        console.error("Error extracting text from PDF:", pdfError);
        throw new Error(`Failed to extract text from PDF`);
      }
    } else {
      throw new Error(`Unsupported file type: ${type}`);
    }
    const normalizedText = this.normalizeText(extractedText).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/([A-Za-zğüşıöçĞÜŞİÖÇ])-\s*([A-Za-zğüşıöçĞÜŞİÖÇ])/g, "$1$2");
    console.log("Normalized text:", normalizedText);
    return normalizedText;
  }
  async modifyOriginalPDF(pdfBuffer, formFields) {
    try {
      const pdfDoc = await pdfLib.PDFDocument.load(pdfBuffer);
      pdfDoc.registerFontkit(fontkit);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();
      console.log("PDF dimensions:", { width, height });
      const validFormFields = formFields.filter(
        (field) => field.x >= 0 && field.x < width && field.y >= 0 && field.y < height
      );
      console.log("Valid form fields to add:", validFormFields);
      let customFont;
      try {
        const fontPath = "C:\\Windows\\Fonts\\arial.ttf";
        const fontBytes = fs__namespace.readFileSync(fontPath);
        customFont = await pdfDoc.embedFont(fontBytes);
      } catch (fontError) {
        console.warn("Could not load Arial font, falling back to Times-Roman:", fontError);
        customFont = await pdfDoc.embedStandardFont(pdfLib.StandardFonts.TimesRoman);
      }
      validFormFields.forEach((field) => {
        if (field.value) {
          const normalizedValue = this.normalizeText(field.value);
          const yPos = height - field.y - 10;
          console.log(`Adding field: ${field.name} with value "${normalizedValue}" at (${field.x}, ${yPos})`);
          firstPage.drawText(normalizedValue, {
            x: field.x,
            y: yPos,
            size: 11,
            font: customFont,
            color: pdfLib.rgb(0, 0, 0)
          });
        }
      });
      const modifiedPdfBytes = await pdfDoc.save();
      return buffer.Buffer.from(modifiedPdfBytes);
    } catch (error) {
      console.error("Error modifying PDF:", error);
      throw error;
    }
  }
}
let lastScannedFilePath = "";
const defaultScansDir = path__namespace.join(electron.app.getPath("home"), "Downloads", "afai-desktop-x", "scans");
function getMostRecentFile(directory) {
  try {
    if (!fs__namespace.existsSync(directory)) {
      console.log(`Scans directory does not exist: ${directory}`);
      return null;
    }
    const files = fs__namespace.readdirSync(directory).filter((file) => fs__namespace.statSync(path__namespace.join(directory, file)).isFile()).map((file) => ({
      name: file,
      path: path__namespace.join(directory, file),
      mtime: fs__namespace.statSync(path__namespace.join(directory, file)).mtime
    })).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return files.length > 0 ? files[0].path : null;
  } catch (error) {
    console.error("Error getting most recent file:", error);
    return null;
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
  electron.ipcMain.handle("scan-document", async () => {
    try {
      let scriptPath = "";
      if (electron.app.isPackaged) {
        scriptPath = path__namespace.join(process.resourcesPath, "advanced_scanner_printer.py");
      } else {
        scriptPath = path__namespace.join(electron.app.getAppPath(), "advanced_scanner_printer.py");
        if (!fs__namespace.existsSync(scriptPath)) {
          const downloadsPath = path__namespace.join(electron.app.getPath("home"), "Downloads", "advanced_scanner_printer.py");
          if (fs__namespace.existsSync(downloadsPath)) {
            scriptPath = downloadsPath;
          } else {
            throw new Error("Scanner script not found. Please place advanced_scanner_printer.py in the app root or Downloads folder.");
          }
        }
      }
      console.log("Using scanner script at:", scriptPath);
      const execPromise = (command) => {
        return new Promise((resolve, reject) => {
          child_process.exec(command, { timeout: 6e4 }, (error, stdout, stderr) => {
            if (error) {
              reject(error);
              return;
            }
            resolve({ stdout, stderr });
          });
        });
      };
      try {
        const pythonCommand = `python "${scriptPath}" 1`;
        const { stdout, stderr } = await execPromise(pythonCommand);
        if (stderr) {
          console.error("Scanner stderr:", stderr);
        }
        let scannedFilePath = "";
        const outputLines = stdout.split("\n");
        for (const line of outputLines) {
          if (line.includes("Document successfully scanned to:")) {
            scannedFilePath = line.split("Document successfully scanned to:")[1].trim();
            break;
          }
        }
        if (!scannedFilePath || !fs__namespace.existsSync(scannedFilePath)) {
          const recentFile = getMostRecentFile(defaultScansDir);
          if (!recentFile) {
            throw new Error("Failed to locate scanned document");
          }
          scannedFilePath = recentFile;
        }
        lastScannedFilePath = scannedFilePath;
        const fileBuffer = fs__namespace.readFileSync(scannedFilePath);
        const filename = path__namespace.basename(scannedFilePath);
        return {
          success: true,
          data: fileBuffer,
          filename,
          filePath: scannedFilePath
        };
      } catch (pythonError) {
        console.error("Python script error:", pythonError);
        const recentScan = getMostRecentFile(defaultScansDir);
        if (recentScan) {
          console.log("Found recent scan file:", recentScan);
          lastScannedFilePath = recentScan;
          const fileBuffer = fs__namespace.readFileSync(recentScan);
          const filename = path__namespace.basename(recentScan);
          return {
            success: true,
            data: fileBuffer,
            filename,
            filePath: recentScan
          };
        }
        console.log("Trying fallback to Windows Scan app...");
        try {
          const tempDir = path__namespace.join(electron.app.getPath("temp"), "app-scans");
          if (!fs__namespace.existsSync(tempDir)) {
            fs__namespace.mkdirSync(tempDir, { recursive: true });
          }
          const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/:/g, "-");
          const scanFilePath = path__namespace.join(tempDir, `scan_${timestamp}.pdf`);
          await execPromise("start ms-screenclip:");
          electron.dialog.showMessageBoxSync({
            type: "info",
            title: "Scanner",
            message: "Use the Windows Scan app to scan your document.",
            detail: "When finished, save the document and select it in the application.",
            buttons: ["OK"]
          });
          const result = await electron.dialog.showOpenDialog({
            title: "Select Scanned Document",
            defaultPath: electron.app.getPath("downloads"),
            filters: [
              { name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png"] }
            ],
            properties: ["openFile"]
          });
          if (result.canceled || result.filePaths.length === 0) {
            throw new Error("Scan operation cancelled");
          }
          const selectedFile = result.filePaths[0];
          lastScannedFilePath = selectedFile;
          const fileBuffer = fs__namespace.readFileSync(selectedFile);
          const filename = path__namespace.basename(selectedFile);
          return {
            success: true,
            data: fileBuffer,
            filename,
            filePath: selectedFile
          };
        } catch (fallbackError) {
          console.error("Fallback scan error:", fallbackError);
          throw new Error("Both scan methods failed");
        }
      }
    } catch (error) {
      console.error("Error in scan-document handler:", error);
      const lastScan = getMostRecentFile(defaultScansDir);
      if (lastScan) {
        lastScannedFilePath = lastScan;
        return {
          success: true,
          message: "Using most recent scanned file",
          filePath: lastScan
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to scan document"
      };
    }
  });
  electron.ipcMain.handle("get-last-scan-path", () => {
    if (!lastScannedFilePath || !fs__namespace.existsSync(lastScannedFilePath)) {
      const recentFile = getMostRecentFile(defaultScansDir);
      if (recentFile) {
        lastScannedFilePath = recentFile;
      }
    }
    return {
      path: lastScannedFilePath,
      exists: lastScannedFilePath ? fs__namespace.existsSync(lastScannedFilePath) : false
    };
  });
  electron.ipcMain.handle("open-scan-folder", (_, filePath) => {
    try {
      if (fs__namespace.existsSync(filePath)) {
        const folderPath = path__namespace.dirname(filePath);
        electron.shell.openPath(folderPath);
        return { success: true };
      } else {
        return {
          success: false,
          error: "File does not exist"
        };
      }
    } catch (error) {
      console.error("Error opening scan folder:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open folder"
      };
    }
  });
  electron.ipcMain.handle("open-file", (_, filePath) => {
    try {
      if (fs__namespace.existsSync(filePath)) {
        electron.shell.openPath(filePath);
        return { success: true };
      } else {
        return {
          success: false,
          error: "File does not exist"
        };
      }
    } catch (error) {
      console.error("Error opening file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open file"
      };
    }
  });
  electron.ipcMain.handle("get-file-data-url", (_, filePath) => {
    try {
      if (fs__namespace.existsSync(filePath)) {
        const fileData = fs__namespace.readFileSync(filePath);
        const extension = path__namespace.extname(filePath).toLowerCase();
        let mimeType = "application/octet-stream";
        if (extension === ".pdf") {
          mimeType = "application/pdf";
        } else if ([".jpg", ".jpeg"].includes(extension)) {
          mimeType = "image/jpeg";
        } else if (extension === ".png") {
          mimeType = "image/png";
        } else if (extension === ".gif") {
          mimeType = "image/gif";
        } else if (extension === ".tiff" || extension === ".tif") {
          mimeType = "image/tiff";
        } else if (extension === ".bmp") {
          mimeType = "image/bmp";
        }
        const base64Data = fileData.toString("base64");
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        return {
          success: true,
          dataUrl,
          mimeType
        };
      } else {
        return {
          success: false,
          error: "File does not exist"
        };
      }
    } catch (error) {
      console.error("Error creating data URL:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create data URL"
      };
    }
  });
  electron.ipcMain.handle("get-file-data", (_, filePath) => {
    try {
      if (fs__namespace.existsSync(filePath)) {
        const fileData = fs__namespace.readFileSync(filePath);
        return {
          success: true,
          data: fileData,
          // This will be sent as a binary buffer
          fileName: path__namespace.basename(filePath)
        };
      } else {
        return {
          success: false,
          error: "File does not exist"
        };
      }
    } catch (error) {
      console.error("Error reading file data:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read file data"
      };
    }
  });
  electron.ipcMain.handle("serve-pdf-for-preview", (_, filePath) => {
    try {
      if (fs__namespace.existsSync(filePath)) {
        const tempDir = path__namespace.join(electron.app.getPath("temp"), "pdf-previews");
        if (!fs__namespace.existsSync(tempDir)) {
          fs__namespace.mkdirSync(tempDir, { recursive: true });
        }
        const htmlFilePath = path__namespace.join(tempDir, `preview-${Date.now()}.html`);
        const pdfJsPrefix = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.10.111";
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>PDF Preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    #viewer {
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe 
    id="viewer" 
    src="${pdfJsPrefix}/web/viewer.html?file=file://${filePath.replace(/\\/g, "/")}"
    allowfullscreen 
    webkitallowfullscreen>
  </iframe>
</body>
</html>
        `;
        fs__namespace.writeFileSync(htmlFilePath, htmlContent);
        electron.shell.openPath(htmlFilePath);
        return {
          success: true,
          htmlPath: htmlFilePath
        };
      } else {
        return {
          success: false,
          error: "File does not exist"
        };
      }
    } catch (error) {
      console.error("Error serving PDF for preview:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to serve PDF"
      };
    }
  });
  electron.ipcMain.handle("process-file", async (_, args) => {
    try {
      const { fileData, userData } = args;
      const aiService = new OpenAIService("xai-nYAPY2BlNL4n3DkHvFLkU2WKq9gWBmHvg9vAtjKuIWVJ2ddVfqPxFh7cYns954cFdIH1K2ACQO5nS7lg");
      const processedBuffer = await aiService.processFileContent({
        name: fileData.name,
        type: fileData.type,
        buffer: fileData.buffer,
        userData
      });
      const savedFilePath = await saveProcessedFile(processedBuffer, fileData.name);
      return {
        success: true,
        data: processedBuffer,
        savedFilePath
      };
    } catch (error) {
      console.error("Error in process-file handler:", error);
      return {
        success: false,
        error: "Failed to process document"
      };
    }
  });
  async function saveProcessedFile(buffer2, originalFileName) {
    try {
      const processedDir = path__namespace.join(electron.app.getPath("documents"), "afai-desktop-x", "processed");
      if (!fs__namespace.existsSync(processedDir)) {
        fs__namespace.mkdirSync(processedDir, { recursive: true });
      }
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const fileExtension = path__namespace.extname(originalFileName) || ".pdf";
      const baseFileName = path__namespace.basename(originalFileName, fileExtension);
      const newFileName = `${baseFileName}_processed_${timestamp}${fileExtension}`;
      const filePath = path__namespace.join(processedDir, newFileName);
      fs__namespace.writeFileSync(filePath, buffer2);
      console.log(`Processed file saved to: ${filePath}`);
      lastProcessedFilePath = filePath;
      return filePath;
    } catch (error) {
      console.error("Error saving processed file:", error);
      throw error;
    }
  }
  electron.ipcMain.handle("open-processed-folder", () => {
    try {
      const processedDir = path__namespace.join(electron.app.getPath("documents"), "afai-desktop-x", "processed");
      if (!fs__namespace.existsSync(processedDir)) {
        fs__namespace.mkdirSync(processedDir, { recursive: true });
      }
      electron.shell.openPath(processedDir);
      return { success: true };
    } catch (error) {
      console.error("Error opening processed folder:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to open folder"
      };
    }
  });
  let lastProcessedFilePath = "";
  electron.ipcMain.handle("get-last-processed-path", () => {
    return {
      success: lastProcessedFilePath ? true : false,
      path: lastProcessedFilePath,
      exists: lastProcessedFilePath ? fs__namespace.existsSync(lastProcessedFilePath) : false
    };
  });
  electron.ipcMain.handle("print-pdf-file", async (_, filePath) => {
    try {
      if (!fs__namespace.existsSync(filePath)) {
        return {
          success: false,
          error: "File does not exist"
        };
      }
      console.log(`Printing PDF file: ${filePath}`);
      let pythonScriptPath = "";
      if (electron.app.isPackaged) {
        pythonScriptPath = path__namespace.join(process.resourcesPath, "advanced_scanner_printer.py");
      } else {
        pythonScriptPath = path__namespace.join(electron.app.getAppPath(), "advanced_scanner_printer.py");
        if (!fs__namespace.existsSync(pythonScriptPath)) {
          const downloadsPath = path__namespace.join(electron.app.getPath("home"), "Downloads", "advanced_scanner_printer.py");
          if (fs__namespace.existsSync(downloadsPath)) {
            pythonScriptPath = downloadsPath;
          } else {
            throw new Error("Scanner script not found. Please place advanced_scanner_printer.py in the app root or Downloads folder.");
          }
        }
      }
      if (!fs__namespace.existsSync(pythonScriptPath)) {
        return {
          success: false,
          error: `Python script not found at ${pythonScriptPath}`
        };
      }
      const command = `python "${pythonScriptPath}" print_with_sumatra "${filePath}"`;
      console.log(`Executing print command: ${command}`);
      const result = child_process.execSync(command, { encoding: "utf8" });
      console.log("Print command result:", result);
      return {
        success: true,
        message: "Document sent to printer"
      };
    } catch (error) {
      console.error("Error printing PDF file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to print PDF file"
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
