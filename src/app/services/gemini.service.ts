import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
    providedIn: 'root'
})
export class GeminiService {
    // ✅ Google Gemini API - MIỄN PHÍ
    // Lấy API key tại: https://aistudio.google.com/app/apikey
    private apiKey = 'AIzaSyAfDph_OchPcE3izsHyUIMPQF0A55cjPpU'; // <-- PASTE API KEY MỚI VÀO ĐÂY

    private ai: GoogleGenAI | null = null;

    // Models để fallback
    private models = [
        'gemini-2.5-flash',          // Mới nhất, nhanh
        'gemini-2.0-flash',          // Stable flash
        'gemini-1.5-flash',          // Backup
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
                contents: prompt,
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
                contents: prompt,
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
}
