import { Component, OnDestroy } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonSelect, IonSelectOption, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, AlertController } from '@ionic/angular/standalone';
import { ExploreContainerComponent } from '../explore-container/explore-container.component';
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { Platform } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LANGUAGE_CONFIG, LanguageOption } from '../../config/language.config';

interface SpeechPartialResult {
  matches?: string[];
  isFinal?: boolean;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonSelect, IonSelectOption, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, ExploreContainerComponent, CommonModule, FormsModule],
})
export class Tab1Page implements OnDestroy {
  public isRecording = false;
  public recognizedText = '';
  public availableLanguages: LanguageOption[] = [];
  public selectedLanguage = 'en-US';
  public hasPermission = false;

  private isProcessing = false;
  private partialResultsListener: any;
  private recordingTimeout: any;

  constructor(
    private platform: Platform,
    private alertController: AlertController
  ) {
    this.platform.ready().then(() => {
      this.initialize();
    });
  }

  async initialize(): Promise<void> {
    if (this.platform.is('capacitor')) {
      const available = await this.checkAvailability();
      if (!available) {
        this.recognizedText = 'Speech recognition không hỗ trợ trên thiết bị này';
        return;
      }

      await this.checkAndRequestPermission();
      if (this.hasPermission) {
        this.setDefaultLanguages();
      }
    } else {
      console.warn('Speech recognition chỉ hỗ trợ trên thiết bị Capacitor (Android/iOS).');
      this.recognizedText = 'Tính năng chỉ chạy trên Android/iOS (Capacitor).';
    }
  }
  private setDefaultLanguages(): void {
    this.availableLanguages = LANGUAGE_CONFIG;
    console.log('Using default languages:', this.availableLanguages);
  }
  private async checkAvailability(): Promise<boolean> {
    try {
      const result = await SpeechRecognition.available();
      console.log('Speech recognition available:', result.available);
      return result.available;
    } catch (error) {
      console.error('Lỗi khi kiểm tra tính khả dụng:', error);
      return false;
    }
  }
  async checkAndRequestPermission(): Promise<void> {
    try {
      console.log('Checking permissions...');
      const permission = await SpeechRecognition.checkPermissions();
      console.log('Permission status:', permission);
      
      if (permission.speechRecognition === 'granted') {
        this.hasPermission = true;
        console.log('Permission already granted');
      } else if (permission.speechRecognition === 'prompt' || permission.speechRecognition === 'prompt-with-rationale' || permission.speechRecognition === 'denied') {
        console.log('Requesting permissions...');
        const requestResult = await SpeechRecognition.requestPermissions();
        console.log('Request result:', requestResult);
        this.hasPermission = requestResult.speechRecognition === 'granted';
      }

      if (!this.hasPermission) {
        console.error('Không có quyền truy cập microphone');
      }
    } catch (error) {
      console.error('Lỗi khi kiểm tra quyền:', error);
    }
  }
  async toggleRecording(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      if (this.isRecording) {
        await this.stopRecording();
      } else {
        await this.startRecording();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async startRecording(): Promise<void> {
    if (!this.platform.is('capacitor')) {
      this.recognizedText = 'Speech recognition không hỗ trợ trên web';
      return;
    }

    if (!this.hasPermission) {
      await this.showPermissionAlert();
      return;
    }

    try {
      console.log('Starting recording with language:', this.selectedLanguage);
      this.recognizedText = 'Đang lắng nghe...';
      this.isRecording = true;

      // Cleanup listener cũ trước khi start
      this.cleanupListener();

      // Thêm listener cho partial results
      this.partialResultsListener = await SpeechRecognition.addListener(
        'partialResults',
        (data: any) => {
          console.log('Partial results event:', data);
          if (data?.matches && data.matches.length > 0) {
            this.recognizedText = data.matches[0];
            console.log('Updated recognized text:', this.recognizedText);
          }
        }
      );

      // Thêm listener cho listening state
      const listeningStateListener = await SpeechRecognition.addListener(
        'listeningState',
        (data: any) => {
          console.log('Listening state event:', data);
          if (data?.status === 'stopped') {
            // Khi listening dừng, tự động stop recording
            setTimeout(() => {
              this.stopRecording();
            }, 500);
          }
        }
      );

      // Lưu listeningStateListener
      (this as any).listeningStateListener = listeningStateListener;

      // Start listening
      await SpeechRecognition.start({
        language: this.selectedLanguage,
        maxResults: 2,
        prompt: 'Hãy nói gì đó...',
        partialResults: true,
        popup: false,
      });

      console.log('Recording started successfully');

      // Timeout 30s để tránh hang
      this.recordingTimeout = setTimeout(() => {
        if (this.isRecording) {
          console.warn('Recording timeout, stopping...');
          this.stopRecording();
        }
      }, 30000);

    } catch (error) {
      console.error('Lỗi khi bắt đầu ghi âm:', error);
      this.recognizedText = `Lỗi: ${error instanceof Error ? error.message : String(error)}`;
      this.isRecording = false;
      this.cleanupListener();
    }
  }

  private async stopRecording(): Promise<void> {
    console.log('Stopping recording...');
    this.isRecording = false;
    
    try {
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }
      
      if (this.platform.is('capacitor')) {
        await SpeechRecognition.stop();
        console.log('Recording stopped');
      }
    } catch (error) {
      console.error('Lỗi khi dừng ghi âm:', error);
    } finally {
      this.cleanupAllListeners();
    }
  }

  private cleanupAllListeners(): void {
    if (this.partialResultsListener) {
      this.partialResultsListener.remove();
      this.partialResultsListener = null;
    }
    if ((this as any).listeningStateListener) {
      (this as any).listeningStateListener.remove();
      (this as any).listeningStateListener = null;
    }
  }

  private cleanupListener(): void {
    if (this.partialResultsListener) {
      this.partialResultsListener.remove();
      this.partialResultsListener = null;
    }
  }

  private async showPermissionAlert(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Cảnh báo',
      message: 'Vui lòng cấp quyền microphone trong cài đặt ứng dụng',
      buttons: ['OK']
    });
    await alert.present();
  }

  ngOnDestroy(): void {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }
    this.cleanupAllListeners();
    if (this.isRecording) {
      this.isRecording = false;
    }
  }
}