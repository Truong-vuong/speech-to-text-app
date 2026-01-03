import { Component, signal, NgZone } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonSelect, IonSelectOption, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList, IonIcon } from '@ionic/angular/standalone';
import { Clipboard } from '@capacitor/clipboard';
import { Platform, ToastController } from '@ionic/angular/standalone';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { SpeechSynthesis } from '@capgo/capacitor-speech-synthesis';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { copyOutline, trashOutline, micOutline, stopOutline, sparklesOutline, volumeHighOutline } from 'ionicons/icons';
import { GeminiService } from '../services/gemini.service';

interface Sentence {
  id: string;
  text: string;
  timestamp: Date;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonSelect, IonSelectOption, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList, IonIcon, CommonModule, FormsModule],
})
export class Tab1Page {
  // ✅ States
  public isRecording = signal(false);
  public currentText = signal(''); // Text hiện tại đang nói (real-time)
  public sentences = signal<Sentence[]>([]); // ✅ Danh sách câu đã ngắt
  public history = signal<{ text: string, time: Date, language: string }[]>([]);

  // ✅ Capgo Speech Recognition config
  public availableLanguages: string[] = [];
  private defaultLanguages: string[] = [
    'vi-VN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW',
    'fr-FR', 'de-DE', 'es-ES', 'es-MX', 'th-TH', 'id-ID', 'hi-IN', 'ru-RU'
  ];
  public selectedLanguage = 'vi-VN';
  public hasPermission = false;

  // ✅ Tùy chọn xử lý AI & TTS
  public enabledAi = true;
  public enabledVoices = true;

  // ✅ Biến quản lý ngắt câu
  private lastPartialResultTime = 0;
  private silenceThreshold = 2000; // 2 giây im lặng = ngắt câu
  private silenceCheckInterval: any = null;
  private currentSentenceText = '';
  private userRequestedStop = false;

  get silenceSeconds() {
    return this.silenceThreshold / 1000;
  }

  constructor(
    private platform: Platform,
    private ngZone: NgZone,
    private toastController: ToastController,
    private geminiService: GeminiService
  ) {
    addIcons({ copyOutline, trashOutline, micOutline, stopOutline, sparklesOutline, volumeHighOutline });
    this.platform.ready().then(() => {
      this.initialize();
      this.loadHistory();
    });
  }

  async initialize() {
    // ✅ Kiểm tra và yêu cầu quyền microphone
    await this.checkAndRequestPermission();

    if (this.hasPermission) {
      await this.loadAvailableLanguages();
      this.setupSpeechListeners();
    }
  }

  async checkAndRequestPermission() {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        console.warn('Speech Recognition không khả dụng trên thiết bị này');
        this.hasPermission = false;
        return;
      }

      const permStatus = await SpeechRecognition.checkPermissions();
      if (permStatus.speechRecognition !== 'granted') {
        const result = await SpeechRecognition.requestPermissions();
        this.hasPermission = result.speechRecognition === 'granted';
      } else {
        this.hasPermission = true;
      }

      console.log('✅ Permission granted:', this.hasPermission);
    } catch (error) {
      console.error('❌ Lỗi kiểm tra permission:', error);
      this.hasPermission = false;
    }
  }

  async loadAvailableLanguages() {
    try {
      const { languages } = await SpeechRecognition.getSupportedLanguages();
      this.availableLanguages = languages.length > 0 ? languages : this.defaultLanguages;
      console.log('✅ Available languages:', this.availableLanguages);
    } catch (error) {
      console.warn('Không lấy được danh sách ngôn ngữ, dùng mặc định');
      this.availableLanguages = this.defaultLanguages;
    }
  }

  /**
   * ✅ Setup listeners cho Speech Recognition
   */
  private setupSpeechListeners() {
    // ✅ Listener nhận kết quả partial
    SpeechRecognition.addListener('partialResults', (data: any) => {
      this.lastPartialResultTime = Date.now();

      this.ngZone.run(() => {
        if (data.matches && data.matches.length > 0) {
          const text = data.matches[0];
          this.currentSentenceText = text;
          this.currentText.set(text || '🎤 Đang lắng nghe...');
        }
      });
    });

    // ✅ Listener khi engine dừng (có thể do hết câu hoặc lỗi)
    SpeechRecognition.addListener('listeningState', (data: any) => {
      console.log('📡 Listening state:', data.status);

      this.ngZone.run(() => {
        if (data.status === 'stopped' && this.isRecording() && !this.userRequestedStop) {
          // ✅ Nếu có text, lưu lại trước khi restart
          if (this.currentSentenceText.trim()) {
            this.finalizeSentence();
          }
          // ✅ Restart để tiếp tục nghe
          this.restartRecognition();
        }
      });
    });
  }

  /**
   * ✅ Bắt đầu ghi âm
   */
  async startRecording() {
    this.userRequestedStop = false;

    if (!this.hasPermission) {
      await this.checkAndRequestPermission();
      if (!this.hasPermission) {
        this.currentText.set('❌ Vui lòng cấp quyền microphone');
        return;
      }
    }

    try {
      this.currentText.set('🎤 Đang lắng nghe...');
      this.currentSentenceText = '';
      this.sentences.set([]);
      this.lastPartialResultTime = Date.now();

      console.log('🔴 Bắt đầu ghi âm bằng @capgo/capacitor-speech-recognition...');

      await SpeechRecognition.start({
        language: this.selectedLanguage,
        partialResults: true,
        popup: false,
      });

      this.isRecording.set(true);
      this.startSilenceDetection();

    } catch (error) {
      console.error('❌ Lỗi khi bắt đầu ghi âm:', error);
      this.isRecording.set(false);
      this.currentText.set('Lỗi: ' + error);
    }
  }

  /**
   * ✅ Khởi động lại recognition
   */
  private async restartRecognition() {
    if (!this.isRecording() || this.userRequestedStop) return;

    try {
      console.log('🔄 Khởi động lại recognition...');
      this.currentSentenceText = '';
      this.currentText.set('🎤 Đang lắng nghe...');
      this.lastPartialResultTime = Date.now();

      await SpeechRecognition.start({
        language: this.selectedLanguage,
        partialResults: true,
        popup: false,
      });

    } catch (error) {
      console.error('❌ Lỗi khi restart recognition:', error);
      this.isRecording.set(false);
      this.stopSilenceDetection();
    }
  }

  /**
   * ✅ Dừng ghi âm
   */
  async stopRecording() {
    console.log('🛑 Dừng ghi âm');

    this.userRequestedStop = true;
    this.stopSilenceDetection();
    this.isRecording.set(false);

    // ✅ Lưu câu cuối cùng nếu có
    if (this.currentSentenceText.trim()) {
      this.finalizeSentence();
    }

    this.currentText.set('');

    try {
      await SpeechRecognition.stop();
    } catch (error) {
      console.error('❌ Lỗi khi dừng recognition:', error);
    }

    // ✅ Lưu tất cả câu vào lịch sử
    const allText = this.sentences().map(s => s.text).join('\n');
    if (allText) {
      this.addToHistory(allText);
    }

    this.showToast(`✅ Ghi âm hoàn thành: ${this.sentences().length} câu`);
  }

  /**
   * ✅ Kiểm tra im lặng để ngắt câu
   */
  private startSilenceDetection() {
    console.log(`⏱️ Bắt đầu kiểm tra im lặng (threshold: ${this.silenceSeconds}s)`);

    this.stopSilenceDetection();
    this.silenceCheckInterval = setInterval(() => {
      if (!this.isRecording()) {
        this.stopSilenceDetection();
        return;
      }

      const now = Date.now();
      const timeSinceLastResult = now - this.lastPartialResultTime;

      if (timeSinceLastResult > this.silenceThreshold && this.currentSentenceText.trim()) {
        console.log(`🔇 Phát hiện im lặng ${timeSinceLastResult}ms - Ngắt câu`);

        this.ngZone.run(() => {
          this.finalizeSentence();
        });

        this.lastPartialResultTime = Date.now();
      }
    }, 300);
  }

  private stopSilenceDetection() {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }

  /**
   * ✅ Hoàn thành một câu và thêm vào danh sách
   */
  private finalizeSentence() {
    const sentenceText = this.currentSentenceText.trim();

    if (sentenceText && sentenceText !== '') {
      const newSentence: Sentence = {
        id: `sentence_${Date.now()}`,
        text: sentenceText,
        timestamp: new Date(),
      };

      const currentSentences = this.sentences();
      this.sentences.set([...currentSentences, newSentence]);

      console.log(`✅ Câu ${currentSentences.length + 1}: "${sentenceText}"`);
      this.showToast(`✅ Câu ${currentSentences.length + 1}: "${sentenceText}"`);
    }

    this.currentSentenceText = '';
    this.currentText.set('🎤 Đang lắng nghe...');
  }

  // ✅ URL API TTS custom của Goosef
  private readonly GOOSEF_TTS_URL = 'https://goosef.com/thaiminhdung/bot_tts.php?text=';

  /**
   * ✅ Phát tiếng - Ưu tiên Goosef TTS API (hỗ trợ tiếng Việt)
   * Fallback sang native TTS nếu lỗi
   */
  private async speakText(text: string): Promise<boolean> {
    // ✅ 1. Ưu tiên Goosef TTS API (tiếng Việt)
    if (this.selectedLanguage.startsWith('vi')) {
      const success = await this.goosefTts(text);
      if (success) return true;
    }

    // ✅ 2. Fallback: Native TTS (@capgo/capacitor-speech-synthesis)
    return this.fallbackNativeTts(text);
  }

  /**
   * ✅ Goosef TTS API - Đọc tiếng Việt
   */
  private async goosefTts(text: string): Promise<boolean> {
    try {
      console.log('🔊 Đang gọi Goosef TTS API...');
      const encodedText = encodeURIComponent(text);
      const audioUrl = `${this.GOOSEF_TTS_URL}${encodedText}`;

      const audio = new Audio(audioUrl);

      return new Promise((resolve) => {
        audio.onended = () => {
          console.log('✅ Goosef TTS phát xong');
          resolve(true);
        };
        audio.onerror = (err) => {
          console.warn('Goosef TTS lỗi:', err);
          resolve(false);
        };
        audio.play().catch((err) => {
          console.warn('Goosef TTS play() lỗi:', err);
          resolve(false);
        });
      });
    } catch (err) {
      console.warn('Goosef TTS lỗi:', err);
      return false;
    }
  }

  /**
   * ✅ Fallback: Native TTS (@capgo/capacitor-speech-synthesis)
   */
  private async fallbackNativeTts(text: string): Promise<boolean> {
    try {
      const { isAvailable } = await SpeechSynthesis.isAvailable();
      if (!isAvailable) {
        console.warn('Native TTS không khả dụng');
        return false;
      }

      await SpeechSynthesis.speak({
        text,
        language: this.selectedLanguage,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        queueStrategy: 'Flush',
      });

      console.log('✅ Native TTS phát thành công');
      return true;
    } catch (err) {
      console.warn('Native TTS lỗi:', err);
      return false;
    }
  }

  /**
   * ✅ Reset tất cả
   */
  clearResult() {
    this.currentText.set('');
    this.sentences.set([]);
    this.currentSentenceText = '';
  }

  /**
   * ✅ Chuẩn hóa text hiện tại bằng Gemini (nếu bật)
   */
  async normalizeCurrentText() {
    const text = this.currentText();
    if (!text || !this.enabledAi) return;

    try {
      const refined = await this.geminiService.refineTranscription(text, this.selectedLanguage);
      this.currentText.set(refined);
      await this.showToast('✅ Đã chuẩn hóa bằng Gemini');
    } catch (error) {
      console.error('❌ Lỗi normalizeCurrentText:', error);
      await this.showToast('❌ Lỗi AI');
    }
  }

  /**
   * ✅ Đọc to text hiện tại (Capacitor TTS hoặc Web Speech API)
   */
  async speakCurrentText() {
    if (!this.enabledVoices) return;

    const text = this.currentText();
    if (!text) return;

    await this.speakText(text);
  }

  /**
   * ✅ Copy từng câu
   */
  async copySentence(sentence: Sentence) {
    try {
      await Clipboard.write({ string: sentence.text });
      await this.showToast('✅ Đã sao chép!');
    } catch (error) {
      console.error('❌ Lỗi khi copy:', error);
      await this.showToast('❌ Không thể sao chép');
    }
  }

  /**
   * ✅ Copy tất cả câu
   */
  async copyAllSentences() {
    const allText = this.sentences().map(s => s.text).join('\n');
    if (!allText) return;

    try {
      await Clipboard.write({ string: allText });
      await this.showToast('✅ Đã sao chép tất cả!');
    } catch (error) {
      console.error('❌ Lỗi khi copy:', error);
      await this.showToast('❌ Không thể sao chép');
    }
  }

  /**
   * ✅ Xóa 1 câu
   */
  removeSentence(id: string) {
    const currentSentences = this.sentences();
    this.sentences.set(currentSentences.filter(s => s.id !== id));
  }

  /**
   * ✅ Thêm vào lịch sử
   */
  addToHistory(text: string) {
    const newItem = {
      text,
      time: new Date(),
      language: this.selectedLanguage
    };
    const currentHistory = this.history();
    const updatedHistory = [newItem, ...currentHistory].slice(0, 20);
    this.history.set(updatedHistory);
    this.saveHistory();
  }

  /**
   * ✅ Lưu lịch sử vào localStorage
   */
  saveHistory() {
    try {
      localStorage.setItem('speech_history', JSON.stringify(this.history()));
    } catch (error) {
      console.error('❌ Lỗi khi lưu lịch sử:', error);
    }
  }

  /**
   * ✅ Load lịch sử từ localStorage
   */
  loadHistory() {
    try {
      const saved = localStorage.getItem('speech_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.history.set(parsed.map((item: any) => ({
          ...item,
          time: new Date(item.time)
        })));
      }
    } catch (error) {
      console.error('❌ Lỗi khi load lịch sử:', error);
    }
  }

  /**
   * ✅ Chuẩn hóa một item trong lịch sử bằng Gemini
   */
  async normalizeHistoryItem(index: number) {
    if (!this.enabledAi) return;
    const items = this.history();
    const target = items[index];
    if (!target || !target.text) return;

    try {
      const refined = await this.geminiService.refineTranscription(target.text, this.selectedLanguage);
      const updated = items.map((item, i) => i === index ? { ...item, text: refined } : item);
      this.history.set(updated);
      this.saveHistory();
      await this.showToast('✅ Đã chuẩn hóa đoạn lịch sử');
    } catch (error) {
      console.error('❌ Lỗi khi chuẩn hóa lịch sử:', error);
      await this.showToast('❌ Lỗi AI');
    }
  }

  /**
   * ✅ Đọc to một item trong lịch sử
   */
  async speakHistoryItem(index: number) {
    if (!this.enabledVoices) return;

    const items = this.history();
    const target = items[index];
    if (!target || !target.text) return;

    await this.speakText(target.text);
  }

  /**
   * ✅ Copy text từ item lịch sử (overload cho history)
   */
  async copyToClipboard(text?: string) {
    const textToCopy = text || this.currentText();
    if (!textToCopy) {
      await this.showToast('❌ Không có text để copy');
      return;
    }

    try {
      await Clipboard.write({ string: textToCopy });
      await this.showToast('✅ Đã sao chép!');
    } catch (error) {
      console.error('❌ Lỗi khi copy:', error);
      await this.showToast('❌ Không thể sao chép');
    }
  }

  /**
   * ✅ Xóa 1 item khỏi lịch sử
   */
  removeFromHistory(index: number) {
    const currentHistory = this.history();
    const removed = currentHistory.splice(index, 1);
    this.history.set([...currentHistory]);
    this.saveHistory();
    console.log(`🗑️ Xóa khỏi lịch sử: "${removed[0]?.text}"`);
  }

  /**
   * ✅ Xóa toàn bộ lịch sử
   */
  clearHistory() {
    this.history.set([]);
    localStorage.removeItem('speech_history');
    console.log('🗑️ Đã xóa toàn bộ lịch sử');
  }

  /**
   * ✅ Hiển thị toast
   */
  async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }
}