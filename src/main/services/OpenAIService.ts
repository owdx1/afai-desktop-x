import * as mammoth from "mammoth";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { Buffer } from "buffer";
import pdfParse from "pdf-parse";
import { PDFDocument as PDFLib, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import fontkit from 'fontkit';
import axios from 'axios';

export type UserData = {
  id: string
  email: string
  name: string | null
  age: number | null
  phone: string | null
  address: string | null
}

export type FormField = {
  name: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class OpenAIService {
  private openai: OpenAI;
  private readonly apiKey: string;
  private readonly apiType: 'anthropic' | 'openai' | 'groq';
  private readonly TURKISH_CHARS_MAP = {
    // Special characters
    'i\u0307': 'i', // Dotted i
    'i\u0131': 'ı', // Dotless i
    'g\u0306': 'ğ', // g with breve
    'u\u0308': 'ü', // u with diaeresis
    's\u0327': 'ş', // s with cedilla
    'o\u0308': 'ö', // o with diaeresis
    'c\u0327': 'ç', // c with cedilla
    // Broken characters
    'g˘': 'ğ',
    'u¨': 'ü',
    'o¨': 'ö',
    's¸': 'ş',
    'c¸': 'ç',
    // Split characters
    'i ̇': 'i',
    'g ̆': 'ğ',
    'u ̈': 'ü',
    'o ̈': 'ö',
    's ̧': 'ş',
    'c ̧': 'ç'
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    
    // Determine API type based on key format
    if (apiKey.startsWith('sk-ant-')) {
      this.apiType = 'anthropic';
      console.log("Using Anthropic Claude API");
    } else if (apiKey.startsWith('sk-o-')) {
      this.apiType = 'openai';
      console.log("Using OpenAI API");
    } else if (apiKey.startsWith('gsk_')) {
      this.apiType = 'groq';
      console.log("Using Groq API");
    } else {
      // Default to OpenAI
      this.apiType = 'openai';
      console.log("Using default OpenAI API");
    }
    
    if (apiKey === "") {
      console.log("API key not provided");
    }
    
    // Initialize OpenAI client (only used if apiType is 'openai')
    this.openai = new OpenAI({ apiKey: this.apiType === 'openai' ? apiKey : "dummy-key" });
  }

  private normalizeText(text: string): string {
    // First combine any split diacritical marks
    let normalized = text.normalize('NFC');

    // Replace known character combinations
    Object.entries(this.TURKISH_CHARS_MAP).forEach(([incorrect, correct]) => {
      normalized = normalized.replace(new RegExp(incorrect, 'g'), correct);
    });

    // Fix common OCR mistakes and encoding issues
    normalized = normalized
      .replace(/─░/g, 'İ') // Fix İ
      .replace(/─ş/g, 'ş') // Fix ş
      .replace(/─▒/g, 'ı') // Fix ı
      .replace(/─ğ/g, 'ğ') // Fix ğ
      .replace(/─ü/g, 'ü') // Fix ü
      .replace(/─ö/g, 'ö') // Fix ö
      .replace(/─ç/g, 'ç') // Fix ç
      .replace(/([A-Za-z])\s+([A-Za-z])/g, '$1$2') // Join split words
      .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2') // Fix hyphenation
      .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, '$1$2') // Join split characters within words
      .replace(/([A-Za-z])\s+([ğüşıöçĞÜŞİÖÇ])/g, '$1$2') // Join Turkish characters
      .replace(/([ğüşıöçĞÜŞİÖÇ])\s+([A-Za-z])/g, '$1$2') // Join Turkish characters
      .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, '$1$2') // Additional word joining
      .replace(/([A-Za-zğüşıöçĞÜŞİÖÇ])\s*-\s*\n\s*([A-Za-zğüşıöçĞÜŞİÖÇ])/g, '$1$2'); // Better hyphenation handling

    return normalized;
  }

  async processFileContent(fileData: { name: string, type: string, buffer: Buffer, userData: UserData }): Promise<Buffer> {
    try {
      // Extract text as fallback
      const text = await this.extractTextFromDocument(fileData.buffer, fileData.type);
      
      // Convert the PDF buffer to base64 for vision API
      const base64File = fileData.buffer.toString('base64');

      console.log(`Processing file with ${this.apiType} vision capabilities`);

      try {
        let formFields: FormField[] = [];
        
        if (this.apiType === 'anthropic') {
          // Use Anthropic Claude API
          console.log("Attempting to use Claude API with key starting with:", this.apiKey.substring(0, 7) + "...");
          
          const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: "claude-3-opus-20240229",
              max_tokens: 4096,
              messages: [
                {
                  role: 'user',
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
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
              }
            }
          ).catch(error => {
            console.error("Claude API error details:", error.response?.data || error.message);
            throw new Error(`Claude API error: ${error.message}`);
          });

          if (!response.data || !response.data.content || !response.data.content[0] || !response.data.content[0].text) {
            console.error("Unexpected Claude API response structure:", JSON.stringify(response.data));
            throw new Error("Invalid Claude API response structure");
          }

          console.log("Claude Response received successfully");
          const claudeText = response.data.content[0].text;
          console.log("Claude Response:", claudeText.substring(0, 200) + "..."); // Show just beginning of response

          try {
            const content = claudeText || "[]";
            console.log("Content length:", content.length);
            
            // Clean up the response and ensure it's valid JSON
            const cleanJson = content
              .replace(/```json\s*/g, '')  // Remove code block markers
              .replace(/```\s*$/g, '')     // Remove closing code block
              .replace(/[\u0000-\u001F]+/g, "") // Remove control characters
              .trim();

            console.log("Cleaned JSON length:", cleanJson.length); 

            // Extract array portion if present
            const match = cleanJson.match(/\[.*\]/s);  // 's' flag for multiline matching
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
        } else if (this.apiType === 'openai') {
          // Use OpenAI GPT-4 Vision
          console.log("Using OpenAI GPT-4 Vision");
          
          const response = await this.openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            max_tokens: 4096,
            messages: [
              {
                role: 'user',
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
            // Extract JSON array
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
          // Groq API
          console.log("Using Groq API");
          
          const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: "llama3-70b-8192",
              messages: [
                {
                  role: 'user',
                  content: `Here is the form content. Please extract the exact field positions and return only a JSON array:
  
${text}
  
Return the exact field positions matching the form layout.`
                }
              ],
              temperature: 0.1
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
              }
            }
          );
          
          const content = response.data.choices[0].message.content || "[]";
          
          try {
            // Extract JSON array
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

        // Add validation for form fields
        if (!formFields || formFields.length < 4) {
          throw new Error("Insufficient form fields detected");
        }

        // Merge user data with form fields
        formFields = this.mergeUserDataWithFormFields(formFields, fileData.userData);

        // Modify the original PDF with the form fields
        return await this.modifyOriginalPDF(fileData.buffer, formFields);
      } catch (visionError) {
        console.error("Vision API error:", visionError);
        console.log("Falling back to default form field values");
        
        // Use default form layout with more precise coordinates
        const formFields = [
          { name: "Tarih", value: new Date().toLocaleDateString('tr-TR'), x: 500, y: 200, width: 150, height: 20 },
          { name: "İsim", value: this.extractFirstName(fileData.userData.name) || "", x: 100, y: 270, width: 200, height: 30 },
          { name: "Soyisim", value: this.extractLastName(fileData.userData.name) || "", x: 400, y: 270, width: 300, height: 30 },
          { name: "E-Mail", value: fileData.userData.email || "", x: 100, y: 375, width: 600, height: 30 },
          { name: "Adres", value: fileData.userData.address || "", x: 100, y: 510, width: 600, height: 30 }
        ];
        
        // Modify the original PDF with the form fields
        return await this.modifyOriginalPDF(fileData.buffer, formFields);
      }

    } catch (error) {
      console.error("Error processing file:", error);
      throw error;
    }
  }

  private extractLastName(fullName: string | null): string | null {
    if (!fullName) return null;
    const nameParts = fullName.trim().split(' ');
    return nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
  }

  private extractFirstName(fullName: string | null): string | null {
    if (!fullName) return null;
    const nameParts = fullName.trim().split(' ');
    if (nameParts.length <= 1) return fullName;
    // Return all parts except the last name (which is the surname)
    return nameParts.slice(0, -1).join(' ');
  }

  private mergeUserDataWithFormFields(formFields: FormField[], userData: UserData): FormField[] {
    // Map user data to appropriate form fields based on field names
    return formFields.map(field => {
      const lowerFieldName = field.name.toLowerCase();
      
      if ((lowerFieldName.includes('isim') || lowerFieldName.includes('ad')) && !lowerFieldName.includes('soy')) {
        field.value = this.extractFirstName(userData.name) || field.value;
      } else if (lowerFieldName.includes('soyisim') || lowerFieldName.includes('soyad')) {
        field.value = this.extractLastName(userData.name) || field.value;
      } else if (lowerFieldName.includes('e-mail') || lowerFieldName.includes('email')) {
        field.value = userData.email || field.value;
      } else if (lowerFieldName.includes('adres')) {
        field.value = userData.address || field.value;
      } else if (lowerFieldName.includes('tarih')) {
        field.value = new Date().toLocaleDateString('tr-TR');
      }
      
      return field;
    });
  }

  private async extractTextFromDocument(buffer: Buffer, type: string): Promise<string> {
    let extractedText = '';

    if (type.includes('docx')) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (type.includes('pdf')) {
      try {
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text;
        console.log("Extracted PDF text:", extractedText); // Debug log
      } catch (pdfError) {
        console.error("Error extracting text from PDF:", pdfError);
        throw new Error(`Failed to extract text from PDF`);
      }
    } else {
      throw new Error(`Unsupported file type: ${type}`);
    }

    // Pre-process the extracted text
    const normalizedText = this.normalizeText(extractedText)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([A-Za-zğüşıöçĞÜŞİÖÇ])-\s*([A-Za-zğüşıöçĞÜŞİÖÇ])/g, '$1$2');

    console.log("Normalized text:", normalizedText); // Debug log
    return normalizedText;
  }

  private async modifyOriginalPDF(pdfBuffer: Buffer, formFields: FormField[]): Promise<Buffer> {
    try {
      // Load the original PDF
      const pdfDoc = await PDFLib.load(pdfBuffer);

      // Register fontkit
      (pdfDoc as any).registerFontkit(fontkit);

      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      console.log("PDF dimensions:", { width, height }); // Debug log
      
      // Filter out any fields that would be outside the PDF boundaries
      const validFormFields = formFields.filter(field => 
        field.x >= 0 && field.x < width && 
        field.y >= 0 && field.y < height
      );
      
      console.log("Valid form fields to add:", validFormFields); // Debug log

      // Try to use Arial Unicode MS which supports Turkish characters
      let customFont;
      try {
        // Try windows fonts first
        const fontPath = 'C:\\Windows\\Fonts\\arial.ttf';
        const fontBytes = fs.readFileSync(fontPath);
        customFont = await pdfDoc.embedFont(fontBytes);
      } catch (fontError) {
        console.warn("Could not load Arial font, falling back to Times-Roman:", fontError);
        customFont = await pdfDoc.embedStandardFont(StandardFonts.TimesRoman);
      }

      // Add text to each form field
      validFormFields.forEach(field => {
        if (field.value) {
          const normalizedValue = this.normalizeText(field.value);
          
          // PDF coordinates start from bottom-left, convert from our top-left origin
          // Form fields here are expected to use top-left as origin
          const yPos = height - field.y - 10; // Add 10pt offset to align text with fields better
          
          console.log(`Adding field: ${field.name} with value "${normalizedValue}" at (${field.x}, ${yPos})`);
          
          firstPage.drawText(normalizedValue, {
            x: field.x,
            y: yPos,
            size: 11,
            font: customFont,
            color: rgb(0, 0, 0)
          });
        }
      });

      // Save the modified PDF
      const modifiedPdfBytes = await pdfDoc.save();
      return Buffer.from(modifiedPdfBytes);
    } catch (error) {
      console.error("Error modifying PDF:", error);
      throw error;
    }
  }
}