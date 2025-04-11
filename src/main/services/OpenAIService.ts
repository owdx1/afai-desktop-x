import { Document, Packer, Paragraph, TextRun } from "docx";
import * as mammoth from "mammoth";
import Groq from "groq-sdk"

export class OpenAIService {
  private groq: Groq;

  constructor(qroqKey: string) {
    if (qroqKey === "") console.log("API key not provided");
    this.groq = new Groq({ apiKey: qroqKey });
  }

  async processFileContent(fileData: { name: string, type: string, buffer: Buffer, clientMetadata: {
    name: string
    email: string
  } }): Promise<Buffer> {
    try {
      const text = await this.extractTextFromDocx(fileData.buffer);

      const resp = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `Fill the fields according to this info: ${fileData.clientMetadata.name} - ${fileData.clientMetadata.email} Field There are empty fields in this docx form. Fill the empty fields and return the form as a whole. ONLY fill empty blanks. DO NOT add your expressions. For example, DO NOT ADD "Here is the form" text on top of the RESPONSE. DO NOT ADD ANY ADDITIONAL CONTENT`
          },
          {
            role: 'user',
            content: `Document Content:\n\n${text}`
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

  private async extractTextFromDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private async generateDocx(text: string): Promise<Buffer> {
    const doc = new Document({
      sections: [{
        children: [new Paragraph(text)]
      }]
    });

    return await Packer.toBuffer(doc);
  }
}
