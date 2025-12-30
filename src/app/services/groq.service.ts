import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class GroqService {
    // ✅ Groq API - MIỄN PHÍ, RẤT NHANH!
    // Lấy API key tại: https://console.groq.com/keys
    // Rate limit: 30 requests/phút, 14,400 requests/ngày (FREE)
    private apiKey = ''; // <-- PASTE GROQ API KEY VÀO ĐÂY

    private apiUrl = 'https://api.groq.com/openai/v1/chat/completions';

    // Groq models (tất cả miễn phí)
    private models = [
        'llama-3.3-70b-versatile',  // Mạnh nhất, 30 RPM
        'llama-3.1-8b-instant',     // Nhanh nhất, 30 RPM
        'mixtral-8x7b-32768',       // Backup
    ];
    private currentModelIndex = 0;

    constructor(private http: HttpClient) { }

    /**
     * Gửi text qua Groq để sửa lỗi
     */
    async refineTranscription(rawText: string, language: string = 'vi-VN'): Promise<string> {
        if (!this.apiKey) {
            console.warn('Groq API key chưa được cấu hình');
            return rawText;
        }

        const languageName = this.getLanguageName(language);

        const prompt = `Sửa lỗi chính tả, ngữ pháp và thêm dấu câu cho văn bản speech-to-text sau. 
CHỈ trả về văn bản đã sửa, không giải thích.
Ngôn ngữ: ${languageName}
Văn bản: "${rawText}"`;

        try {
            console.log('Đang gọi Groq model:', this.models[this.currentModelIndex]);

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
            console.error('Lỗi khi gọi Groq API:', JSON.stringify(error));
            console.error('Error status:', error.status);

            // Nếu hết quota (429), thử model khác
            if (error.status === 429) {
                console.warn('Rate limit cho model:', this.models[this.currentModelIndex]);

                if (this.currentModelIndex < this.models.length - 1) {
                    this.currentModelIndex++;
                    console.log('Đang thử model khác:', this.models[this.currentModelIndex]);
                    return this.refineTranscription(rawText, language);
                } else {
                    console.error('Tất cả models đều hết quota! Đợi 1 phút.');
                    this.currentModelIndex = 0;
                }
            } else if (error.status === 401) {
                console.error('API key không hợp lệ');
            }

            return rawText;
        }
    }

    /**
     * Set API key
     */
    setApiKey(key: string) {
        this.apiKey = key;
    }

    /**
     * Kiểm tra API key
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
