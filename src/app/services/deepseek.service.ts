import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class DeepSeekService {
    // ✅ DeepSeek API - Giá rẻ, chất lượng cao
    // Lấy API key tại: https://platform.deepseek.com/api_keys
    // Giá: ~$0.14/1M input tokens, ~$0.28/1M output tokens
    private apiKey = 'sk-987243abf5fa42a8938a46f4a066b732'; // <-- PASTE DEEPSEEK API KEY VÀO ĐÂY

    private apiUrl = 'https://api.deepseek.com/v1/chat/completions';

    // DeepSeek models
    private models = [
        'deepseek-chat',     // DeepSeek-V3, mạnh nhất
        'deepseek-reasoner', // DeepSeek-R1, reasoning model
    ];
    private currentModelIndex = 0;

    constructor(private http: HttpClient) { }

    /**
     * Gửi text qua DeepSeek để sửa lỗi
     */
    async refineTranscription(rawText: string, language: string = 'vi-VN'): Promise<string> {
        if (!this.apiKey) {
            console.warn('DeepSeek API key chưa được cấu hình');
            return rawText;
        }

        const languageName = this.getLanguageName(language);

        const prompt = `Sửa lỗi chính tả, ngữ pháp và thêm dấu câu cho văn bản speech-to-text sau. 
CHỈ trả về văn bản đã sửa, không giải thích.
Ngôn ngữ: ${languageName}
Văn bản: "${rawText}"`;

        try {
            console.log('Đang gọi DeepSeek model:', this.models[this.currentModelIndex]);

            const body = {
                model: this.models[this.currentModelIndex],
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 500,
            };

            const response: any = await firstValueFrom(
                this.http.post(this.apiUrl, body, {
                    headers: new HttpHeaders({
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    })
                })
            );

            const refinedText = response.choices?.[0]?.message?.content?.trim();
            return refinedText || rawText;

        } catch (error: any) {
            console.error('Lỗi khi gọi DeepSeek API:', JSON.stringify(error));
            console.error('Error status:', error.status);

            // Nếu hết quota (429), thử model khác
            if (error.status === 429) {
                console.warn('Rate limit cho model:', this.models[this.currentModelIndex]);

                if (this.currentModelIndex < this.models.length - 1) {
                    this.currentModelIndex++;
                    console.log('Đang thử model khác:', this.models[this.currentModelIndex]);
                    return this.refineTranscription(rawText, language);
                } else {
                    console.error('Tất cả models đều hết quota!');
                    this.currentModelIndex = 0;
                }
            } else if (error.status === 401) {
                console.error('API key không hợp lệ');
            } else if (error.status === 400) {
                console.error('Request không hợp lệ');
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
        if (!this.apiKey) {
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
            const body = {
                model: this.models[this.currentModelIndex],
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 500,
            };

            const response: any = await firstValueFrom(
                this.http.post(this.apiUrl, body, {
                    headers: new HttpHeaders({
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    })
                })
            );

            const content = response.choices?.[0]?.message?.content;
            // Extract JSON from response (có thể có markdown code block)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
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
     * Set API key
     */
    setApiKey(key: string) {
        this.apiKey = key;
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
