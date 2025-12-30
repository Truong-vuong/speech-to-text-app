import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class OpenAIService {
    // ⚠️ QUAN TRỌNG: Đặt API key vào environment hoặc backend để bảo mật
    // Không nên để API key trực tiếp trong code production
    private apiKey = ''; // Thêm API key của bạn ở đây
    private apiUrl = 'https://api.openai.com/v1/chat/completions';

    constructor(private http: HttpClient) { }

    /**
     * Gửi text qua GPT để sửa lỗi và phân tích ngữ cảnh
     */
    async refineTranscription(rawText: string, language: string = 'vi-VN'): Promise<string> {
        if (!this.apiKey) {
            console.warn('OpenAI API key chưa được cấu hình');
            return rawText; // Trả về text gốc nếu không có API key
        }

        const languageName = this.getLanguageName(language);

        const systemPrompt = `Bạn là trợ lý AI chuyên sửa lỗi và cải thiện văn bản được chuyển đổi từ giọng nói.
Nhiệm vụ của bạn:
1. Sửa lỗi chính tả và ngữ pháp
2. Thêm dấu câu phù hợp
3. Sửa các từ bị nhận diện sai dựa trên ngữ cảnh
4. Giữ nguyên ý nghĩa gốc của người nói
5. Nếu có số được đọc bằng chữ (ví dụ: "hai ba" có thể là "23"), hãy phân tích ngữ cảnh để quyết định

CHỈ trả về văn bản đã sửa, không giải thích.`;

        const userPrompt = `Ngôn ngữ: ${languageName}
Văn bản gốc từ speech recognition: "${rawText}"

Hãy sửa và cải thiện văn bản trên:`;

        try {
            const headers = new HttpHeaders({
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            });

            const body = {
                model: 'gpt-4o-mini', // Hoặc 'gpt-4' nếu cần chính xác hơn
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 500,
                temperature: 0.3 // Giữ output ổn định
            };

            const response: any = await firstValueFrom(
                this.http.post(this.apiUrl, body, { headers })
            );

            const refinedText = response.choices?.[0]?.message?.content?.trim();
            return refinedText || rawText;

        } catch (error: any) {
            console.error('Lỗi khi gọi OpenAI API:', error);

            // Xử lý các lỗi cụ thể
            if (error.status === 401) {
                console.error('API key không hợp lệ');
            } else if (error.status === 429) {
                console.error('Đã vượt quá rate limit');
            }

            return rawText; // Trả về text gốc nếu có lỗi
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

        const systemPrompt = `Bạn là trợ lý AI phân tích văn bản. Trả về JSON với format:
{
  "refinedText": "văn bản đã sửa lỗi",
  "intent": "ý định của người nói (question/command/statement/greeting)",
  "entities": [{"type": "loại", "value": "giá trị"}],
  "summary": "tóm tắt ngắn gọn"
}`;

        try {
            const headers = new HttpHeaders({
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            });

            const body = {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Phân tích văn bản: "${text}"` }
                ],
                max_tokens: 500,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            };

            const response: any = await firstValueFrom(
                this.http.post(this.apiUrl, body, { headers })
            );

            const content = response.choices?.[0]?.message?.content;
            return JSON.parse(content);

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
