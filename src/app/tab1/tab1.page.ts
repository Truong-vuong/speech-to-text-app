import { Component, signal, NgZone } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonSelect, IonSelectOption, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList, IonIcon } from '@ionic/angular/standalone';
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { Clipboard } from '@capacitor/clipboard';
import type { PluginListenerHandle } from '@capacitor/core';
import { Platform, ToastController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { copyOutline, trashOutline, micOutline, stopOutline } from 'ionicons/icons';

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
  public speechRecognition = SpeechRecognition;

  // ✅ States
  public isRecording = signal(false);
  public currentText = signal(''); // Text hiện tại đang nói (real-time)
  public sentences = signal<Sentence[]>([]); // ✅ Danh sách câu đã ngắt
  public history = signal<{ text: string, time: Date, language: string }[]>([]);

  public availableLanguages: string[] = [];
  private defaultLanguage: string[] = ['vi-VN', 'en-US', 'ja-JP', 'ko-KR', 'zh-CN'];
  public selectedLanguage = 'vi-VN';
  public hasPermission = false;

  // ✅ Listeners
  private partialListener?: PluginListenerHandle;
  private listeningStateListener?: PluginListenerHandle;

  // ✅ Biến quản lý ngắt câu
  private lastPartialResultTime = 0; // Thời điểm nhận kết quả cuối cùng
  private silenceThreshold = 2000; // 2 giây im lặng = ngắt câu
  private silenceCheckInterval: any = null;
  private currentSentenceText = ''; // Text của câu hiện tại
  private lastFullText = ''; // Chuỗi full từ speech recognition lần gần nhất
  private savedLength = 0;   // Độ dài đã cắt ra thành câu
  private isNativeListening = false; // Theo dõi trạng thái native để tự khởi động lại
  private userRequestedStop = false; // Phân biệt user bấm Stop hay native tự dừng
  private lastStopReason: 'user' | 'native-stop' | 'error' | 'unknown' = 'unknown';

  get silenceSeconds() {
    return this.silenceThreshold / 1000;
  }

  constructor(
    private platform: Platform,
    private ngZone: NgZone,
    private toastController: ToastController
  ) {
    addIcons({ copyOutline, trashOutline, micOutline, stopOutline });
    this.platform.ready().then(() => {
      this.initialize();
      this.loadHistory();
    });
  }

  async initialize() {
    if (this.platform.is('capacitor')) {
      await this.checkAndRequestPermission();
      if (this.hasPermission) {
        await this.loadAvailableLanguages();
        this.setupListeners();
      }
    } else {
      console.warn('Speech recognition chỉ hỗ trợ trên thiết bị Capacitor (Android/iOS).');
      this.currentText.set('Tính năng chỉ chạy trên Android/iOS (Capacitor).');
    }
  }

  async checkAndRequestPermission() {
    try {
      const permission = await this.speechRecognition.checkPermissions();
      console.log('✅ Permission status:', permission);

      if (permission.speechRecognition === 'prompt' || permission.speechRecognition === 'denied') {
        const requestResult = await this.speechRecognition.requestPermissions();
        console.log('✅ Request result:', requestResult);
        this.hasPermission = requestResult.speechRecognition === 'granted';
      } else if (permission.speechRecognition === 'granted') {
        this.hasPermission = true;
      }

      if (!this.hasPermission) {
        console.error('❌ Không có quyền truy cập microphone');
      }
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra quyền:', error);
    }
  }

  async loadAvailableLanguages() {
    try {
      const languages = await this.speechRecognition.getSupportedLanguages();
      this.availableLanguages = languages.languages || this.defaultLanguage;
      console.log('✅ Available languages:', this.availableLanguages);
    } catch (error) {
      console.error('❌ Lỗi khi lấy danh sách ngôn ngữ:', error);
      this.availableLanguages = this.defaultLanguage;
    }
  }

  /**
   * ✅ Setup listener cho partial results (real-time)
   */
  async setupListeners() {
    await this.partialListener?.remove();
    await this.listeningStateListener?.remove();
    console.log('🔧 Setting up listeners...');

    this.partialListener = await this.speechRecognition.addListener('partialResults', (data: any) => {
      if (data.matches && data.matches.length > 0) {
        const bestMatch = data.matches[0]; // Lấy kết quả tốt nhất (full chuỗi)

        // Nếu native reset và trả chuỗi ngắn hơn phần đã lưu, xem như phiên mới
        if (bestMatch.length < this.savedLength) {
          this.savedLength = 0;
          this.lastFullText = '';
        }

        // Tính phần mới kể từ lần đã lưu trước đó
        const newPart = bestMatch.substring(this.savedLength).trim();

        this.ngZone.run(() => {
          // Hiển thị phần đang nói của câu hiện tại (delta)
          this.currentText.set(newPart || '');
          this.currentSentenceText = newPart;
        });

        // Lưu lại full text lần gần nhất để cập nhật savedLength khi chốt câu
        this.lastFullText = bestMatch;

        // ✅ Cập nhật thời gian nhận kết quả cuối cùng
        this.lastPartialResultTime = Date.now();

        console.log(`📝 Partial result: "${bestMatch}"`);
      }
    });

    // ✅ Lắng nghe trạng thái native để tự khởi động lại nếu session tự dừng
    this.listeningStateListener = await this.speechRecognition.addListener('listeningState', (data: any) => {
      const status = data?.status;
      console.log('👂 listeningState:', status);

      if (status === 'started') {
        this.isNativeListening = true;
        return;
      }

      if (status === 'stopped') {
        this.isNativeListening = false;
        this.lastStopReason = this.userRequestedStop ? 'user' : 'native-stop';

        // Nếu người dùng vẫn đang ghi (chưa bấm Stop), tự khởi động lại
        if (this.isRecording()) {
          // Chốt câu hiện tại nếu còn
          if (this.currentSentenceText.trim()) {
            this.ngZone.run(() => {
              this.finalizeSentence();
            });
          }

          // Khởi động lại phiên native
          this.restartNativeSession();
        }
      }
    });

    console.log('✅ Listeners setup complete');
  }

  /**
   * ✅ Bắt đầu ghi âm và kiểm tra im lặng
   */
  async startRecording() {
    // Đảm bảo listener luôn hoạt động trước khi start
    await this.setupListeners();

    this.userRequestedStop = false;
    this.lastStopReason = 'unknown';

    if (this.platform.is('capacitor') && !this.hasPermission) {
      console.error('❌ Không có quyền ghi âm');
      alert('Vui lòng cấp quyền microphone trong cài đặt');
      return;
    }

    if (!this.platform.is('capacitor')) {
      console.error('❌ Speech recognition không hỗ trợ trên web');
      this.currentText.set('Speech recognition không hỗ trợ trên web');
      return;
    }

    try {
      this.currentText.set('🎤 Đang lắng nghe...');
      this.currentSentenceText = '';
      this.sentences.set([]);
      this.lastPartialResultTime = Date.now();
      this.savedLength = 0;
      this.lastFullText = '';
      this.isNativeListening = false;

      console.log('🔴 Bắt đầu ghi âm...');

      // ✅ allowForSilence=60000 (60 giây): Plugin sẽ KHÔNG tự động dừng
      // Chúng ta sẽ dùng code riêng để phát hiện im lặng 2s và ngắt câu
      // Plugin chỉ dừng khi user bấm stop
      await this.speechRecognition.start({
        language: this.selectedLanguage,
        maxResults: 1,
        popup: false,
        partialResults: true,
        addPunctuation: true,
        allowForSilence: 60000, // ✅ 60 giây: Tránh plugin tự động dừng sớm
      });

      this.isRecording.set(true);

      // ✅ Bắt đầu kiểm tra im lặng mỗi 300ms
      this.startSilenceDetection();

    } catch (error) {
      console.error('❌ Lỗi khi bắt đầu ghi âm:', error);
      this.isRecording.set(false);
      this.currentText.set('Lỗi: ' + error);
    }
  }

  /**
   * ✅ Kiểm tra im lặng để ngắt câu
   * Nếu im lặng > 2 giây → ngắt câu hiện tại
   */
  private startSilenceDetection() {
    console.log(`⏱️ Bắt đầu kiểm tra im lặng (threshold: ${this.silenceSeconds}s)`);

    this.silenceCheckInterval = setInterval(() => {
      if (!this.isRecording()) {
        clearInterval(this.silenceCheckInterval);
        return;
      }

      const now = Date.now();
      const timeSinceLastResult = now - this.lastPartialResultTime;

      // ✅ Nếu im lặng > 2 giây → ngắt câu
      if (timeSinceLastResult > this.silenceThreshold && this.currentSentenceText.trim()) {
        console.log(`🔇 Phát hiện im lặng ${timeSinceLastResult}ms - Ngắt câu`);

        this.ngZone.run(() => {
          this.finalizeSentence();
        });

        // ✅ Reset thời gian để không ngắt lại ngay lập tức
        this.lastPartialResultTime = Date.now();
      }
    }, 300); // Kiểm tra mỗi 300ms
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

      // ✅ Thêm vào danh sách câu
      const currentSentences = this.sentences();
      this.sentences.set([...currentSentences, newSentence]);

      console.log(`✅ Câu ${currentSentences.length + 1}: "${sentenceText}"`);

      // ✅ Hiển thị toast thông báo
      this.showToast(`✅ Câu ${currentSentences.length + 1}: "${sentenceText}"`);
    }

    // ✅ Reset text hiện tại
    this.currentSentenceText = '';
    this.currentText.set('🎤 Đang lắng nghe...');

    // ✅ Đánh dấu đã cắt đến độ dài hiện tại của full text
    this.savedLength = this.lastFullText.length;
  }

  /**
   * ✅ Khởi động lại phiên native nếu engine tự dừng
   */
  private async restartNativeSession() {
    if (!this.isRecording() || this.isNativeListening) return;

    try {
      console.log('🔄 Khởi động lại phiên recognition...');

      // ✅ Reset trạng thái cho phiên mới
      this.currentSentenceText = '';
      this.currentText.set('🎤 Đang lắng nghe...');

      await this.speechRecognition.start({
        language: this.selectedLanguage,
        maxResults: 1,
        popup: false,
        partialResults: true,
        addPunctuation: true,
        // allowForSilence: 60000,
      });

      this.lastPartialResultTime = Date.now();
      this.isNativeListening = true;

    } catch (error) {
      console.error('❌ Lỗi khi khởi động lại recognition:', error);
    }
  }

  /**
   * ✅ Dừng ghi âm
   */
  async stopRecording() {
    console.log('🛑 Dừng ghi âm');

    this.userRequestedStop = true;
    this.lastStopReason = 'user';

    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.isRecording.set(false);
    this.isNativeListening = false;

    // ✅ Lưu câu cuối cùng nếu có
    if (this.currentSentenceText.trim()) {
      this.ngZone.run(() => {
        this.finalizeSentence();
      });
    }

    // Nếu vẫn còn phần text mới sau savedLength mà chưa chốt (trong trường hợp không có partial cuối)
    if (this.lastFullText && this.savedLength < this.lastFullText.length) {
      const newPart = this.lastFullText.substring(this.savedLength).trim();
      if (newPart) {
        this.ngZone.run(() => {
          this.currentSentenceText = newPart;
          this.finalizeSentence();
        });
      }
    }

    this.currentText.set('');

    if (this.platform.is('capacitor')) {
      try {
        await this.speechRecognition.stop();
        console.log('✅ Plugin stopped');
      } catch (error) {
        console.error('❌ Lỗi khi dừng ghi âm:', error);
      }
    }

    // Dọn listener trạng thái
    await this.listeningStateListener?.remove();

    // ✅ Lưu tất cả câu vào lịch sử
    const allText = this.sentences().map(s => s.text).join('\n');
    if (allText) {
      this.addToHistory(allText);
    }

    // ✅ Hiển thị tổng kết
    this.showToast(`✅ Ghi âm hoàn thành: ${this.sentences().length} câu`);
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