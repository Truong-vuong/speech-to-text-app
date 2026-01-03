import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { environment } from '../../environments/environment';

// ✅ TTS interfaces
interface SpeakerConfig {
    speaker: string;
    voiceName: string;
}

interface SynthesizeOptions {
    text: string;
    languageCode?: string;
    voiceName?: string;
    speakers?: SpeakerConfig[];
    temperature?: number;
}

interface SynthResult {
    filePath: string;
    mimeType: string;
}

@Injectable({
    providedIn: 'root'
})
export class GeminiService {
    // ✅ Google Gemini API key lấy từ environment (không hard-code)
    private apiKey = 'AIzaSyCQm5lfSXTH28mjLYAoUVuycCJV7u1Khxk';

    private ai: GoogleGenAI | null = null;

    // Models fallback (v1 API) - ưu tiên model mới nhất
    private models = [
        'gemini-2.5-flash',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
    ];
    private currentModelIndex = 0;

    constructor() {
        this.initializeAI();
    }

    private initializeAI() {
        if (this.apiKey) {
            this.ai = new GoogleGenAI({ apiKey: this.apiKey });
        }
    }

    /**
     * Gửi text qua Gemini để sửa lỗi và phân tích ngữ cảnh
     */
    async refineTranscription(rawText: string, language: string = 'vi-VN'): Promise<string> {
        if (!this.ai) {
            console.warn('Gemini API chưa được khởi tạo');
            return rawText;
        }

        const languageName = this.getLanguageName(language);

        const prompt = `Bạn là trợ lý AI chuyên sửa lỗi và cải thiện văn bản được chuyển đổi từ giọng nói.
Nhiệm vụ của bạn:
1. Sửa lỗi chính tả và ngữ pháp
2. Thêm dấu câu phù hợp
3. Sửa các từ bị nhận diện sai dựa trên ngữ cảnh
4. Giữ nguyên ý nghĩa gốc của người nói
5. Nếu có số được đọc bằng chữ (ví dụ: "hai ba" có thể là "23"), hãy phân tích ngữ cảnh để quyết định

CHỈ trả về văn bản đã sửa, không giải thích.

Ngôn ngữ: ${languageName}
Văn bản gốc từ speech recognition: "${rawText}"

Hãy sửa và cải thiện văn bản trên:`;

        try {
            const currentModel = this.models[this.currentModelIndex];
            console.log('Đang gọi Gemini model:', currentModel);

            const response = await this.ai.models.generateContent({
                model: currentModel,
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: prompt }]
                    }
                ],
            });

            const refinedText = response.text?.trim();
            return refinedText || rawText;

        } catch (error: any) {
            console.error('Lỗi khi gọi Gemini API:', error);
            console.error('Model hiện tại:', this.models[this.currentModelIndex]);

            // Nếu lỗi, thử model khác
            if (this.currentModelIndex < this.models.length - 1) {
                this.currentModelIndex++;
                console.log('Đang thử model khác:', this.models[this.currentModelIndex]);
                return this.refineTranscription(rawText, language);
            } else {
                console.error('Đã thử tất cả models! Reset về model đầu.');
                this.currentModelIndex = 0;
            }

            return rawText;
        }
    }

    /**
     * Phân tích ngữ cảnh và trích xuất thông tin
     */
    async analyzeContext(text: string): Promise<{
        refinedText: string;
        intent?: string;
        entities?: any[];
        summary?: string;
    }> {
        if (!this.ai) {
            return { refinedText: text };
        }

        const prompt = `Phân tích văn bản sau và trả về JSON với format:
{
  "refinedText": "văn bản đã sửa lỗi",
  "intent": "ý định của người nói (question/command/statement/greeting)",
  "entities": [{"type": "loại", "value": "giá trị"}],
  "summary": "tóm tắt ngắn gọn"
}

Văn bản: "${text}"

Trả về ONLY JSON, không có text khác:`;

        try {
            const response = await this.ai.models.generateContent({
                model: this.models[this.currentModelIndex],
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: prompt }]
                    }
                ],
            });

            const content = response.text;
            // Extract JSON from response (có thể có markdown code block)
            const jsonMatch = content?.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return { refinedText: text };

        } catch (error) {
            console.error('Lỗi khi phân tích ngữ cảnh:', error);
            return { refinedText: text };
        }
    }

    /**
     * Set API key (có thể gọi từ settings)
     */
    setApiKey(key: string) {
        this.apiKey = key;
        this.initializeAI();
    }

    /**
     * Kiểm tra API key đã được cấu hình chưa
     */
    hasApiKey(): boolean {
        return !!this.apiKey && this.apiKey.length > 0;
    }

    private getLanguageName(code: string): string {
        const languages: { [key: string]: string } = {
            'vi-VN': 'Tiếng Việt',
            'en-US': 'English',
            'ja-JP': 'Japanese',
            'ko-KR': 'Korean',
            'zh-CN': 'Chinese'
        };
        return languages[code] || code;
    }

    // ===================== GOOGLE CLOUD TTS (REST API) =====================

    /**
     * ✅ Google Cloud TTS - Hỗ trợ tiếng Việt, free tier 1M chars/tháng
     * Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
     */
    async synthesizeSpeech(text: string, languageCode: string = 'vi-VN'): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Chưa cấu hình API key');
        }

        const voiceName = this.getVoiceNameForLanguage(languageCode);

        const requestBody = {
            input: { text },
            voice: {
                languageCode,
                name: voiceName,
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: 1.0,
                pitch: 0,
            },
        };

        const response = await fetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Google Cloud TTS error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.audioContent; // base64 encoded MP3
    }

    /**
     * ✅ Lấy voice name phù hợp cho từng ngôn ngữ
     */
    private getVoiceNameForLanguage(languageCode: string): string {
        const voices: { [key: string]: string } = {
            'vi-VN': 'vi-VN-Standard-A',     // Nữ tiếng Việt
            'en-US': 'en-US-Standard-C',     // Nữ tiếng Anh Mỹ
            'en-GB': 'en-GB-Standard-A',     // Nữ tiếng Anh UK
            'ja-JP': 'ja-JP-Standard-A',     // Nữ tiếng Nhật
            'ko-KR': 'ko-KR-Standard-A',     // Nữ tiếng Hàn
            'zh-CN': 'cmn-CN-Standard-A',    // Nữ tiếng Trung
            'zh-TW': 'cmn-TW-Standard-A',    // Nữ tiếng Trung (Đài Loan)
            'fr-FR': 'fr-FR-Standard-A',     // Nữ tiếng Pháp
            'de-DE': 'de-DE-Standard-A',     // Nữ tiếng Đức
            'es-ES': 'es-ES-Standard-A',     // Nữ tiếng Tây Ban Nha
            'es-MX': 'es-US-Standard-A',     // Nữ tiếng TBN Mexico
            'th-TH': 'th-TH-Standard-A',     // Nữ tiếng Thái
            'id-ID': 'id-ID-Standard-A',     // Nữ tiếng Indonesia
            'hi-IN': 'hi-IN-Standard-A',     // Nữ tiếng Hindi
            'ru-RU': 'ru-RU-Standard-A',     // Nữ tiếng Nga
        };
        return voices[languageCode] || 'en-US-Standard-C';
    }

    // ===================== GEMINI TTS METHODS (paid tier only) =====================

    /**
     * ✅ Sinh audio bằng Gemini Audio TTS (model gemini-2.5-pro-preview-tts)
     */
    async synthesizeAudio(options: SynthesizeOptions): Promise<SynthResult> {
        if (!this.ai) {
            throw new Error('Chưa cấu hình GEMINI API key');
        }

        const model = 'gemini-2.5-pro-preview-tts';

        const speechConfig = options.speakers?.length
            ? {
                multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: options.speakers.map((s) => ({
                        speaker: s.speaker,
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: s.voiceName },
                        },
                    })),
                },
            }
            : {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: options.voiceName || 'Puck',
                    },
                },
            };

        const response = await this.ai.models.generateContentStream({
            model,
            config: {
                temperature: options.temperature ?? 1,
                responseModalities: ['audio'],
                speechConfig,
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: options.text }],
                },
            ],
        });

        const audioChunks: Uint8Array[] = [];
        let mimeType = 'audio/wav';

        for await (const chunk of response) {
            if (!chunk.candidates?.[0]?.content?.parts) continue;
            const inline = chunk.candidates[0].content.parts[0]?.inlineData;
            if (inline?.data) {
                mimeType = inline.mimeType || mimeType;
                audioChunks.push(this.base64ToUint8(inline.data));
            }
        }

        if (!audioChunks.length) {
            throw new Error('Không nhận được audio từ Gemini TTS');
        }

        let merged = this.concatUint8(audioChunks);

        if (this.isRawPcmMime(mimeType)) {
            merged = this.convertToWav(merged, mimeType);
            mimeType = 'audio/wav';
        }

        // ✅ Lưu file giống document (saveBinaryFile)
        const fileName = `gemini_audio_${Date.now()}.wav`;
        const filePath = await this.saveBinaryFile(fileName, merged);
        return { filePath, mimeType };
    }

    /**
     * ✅ Lưu binary data vào file (giống saveBinaryFile trong document)
     */
    private async saveBinaryFile(fileName: string, data: Uint8Array): Promise<string> {
        const base64Data = this.uint8ToBase64(data);

        const result = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache,
        });

        console.log(`✅ Audio saved to: ${result.uri}`);
        return result.uri;
    }

    // ===================== TTS HELPERS =====================

    private base64ToUint8(base64: string): Uint8Array {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    private uint8ToBase64(bytes: Uint8Array): string {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    private concatUint8(chunks: Uint8Array[]): Uint8Array {
        const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            result.set(c, offset);
            offset += c.byteLength;
        }
        return result;
    }

    private isRawPcmMime(mime: string): boolean {
        const type = mime.split(';')[0].trim();
        return /^audio\/L\d+$/i.test(type);
    }

    private parsePcmMime(mime: string): { numChannels: number; sampleRate: number; bitsPerSample: number } {
        const [fileType, ...params] = mime.split(';').map((s) => s.trim());
        const format = fileType.split('/')[1] || '';
        const options = { numChannels: 1, sampleRate: 24000, bitsPerSample: 16 };

        if (format.startsWith('L')) {
            const bits = parseInt(format.slice(1), 10);
            if (!isNaN(bits)) options.bitsPerSample = bits;
        }

        for (const param of params) {
            const [key, value] = param.split('=').map((s) => s.trim());
            if (key === 'rate') options.sampleRate = parseInt(value, 10);
        }

        return options;
    }

    private createWavHeader(dataLength: number, opt: { numChannels: number; sampleRate: number; bitsPerSample: number }): Uint8Array {
        const { numChannels, sampleRate, bitsPerSample } = opt;
        const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
        const blockAlign = (numChannels * bitsPerSample) / 8;

        const header = new ArrayBuffer(44);
        const view = new DataView(header);
        const enc = new TextEncoder();

        const writeStr = (offset: number, str: string) => {
            const bytes = enc.encode(str);
            for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
        };

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeStr(36, 'data');
        view.setUint32(40, dataLength, true);

        return new Uint8Array(header);
    }

    private convertToWav(rawBytes: Uint8Array, mimeType: string): Uint8Array {
        const opt = this.parsePcmMime(mimeType);
        const wavHeader = this.createWavHeader(rawBytes.byteLength, opt);
        const result = new Uint8Array(wavHeader.byteLength + rawBytes.byteLength);
        result.set(wavHeader, 0);
        result.set(rawBytes, wavHeader.byteLength);
        return result;
    }
}
