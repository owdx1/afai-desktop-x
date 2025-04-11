import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: {
          "welcome": "Welcome to AFAI!",
          "signInPrompt": "Please Sign In with your AFAI client email",
          "signIn": "Sign In",
          "loadingUser": "Loading User Information...",
          "navigation": {
            "home": "Home",
            "profile": "Profile"
          },
          "buttons": {
            "submit": "Submit",
            "cancel": "Cancel",
            "save": "Save"
          }
        }
      },
      es: {
        translation: {
          "welcome": "¡Bienvenido a AFAI!",
          "signInPrompt": "Inicie sesión con su correo electrónico de cliente AFAI",
          "signIn": "Iniciar Sesión",
          "loadingUser": "Cargando información del usuario...",
          "navigation": {
            "home": "Inicio",
            "profile": "Perfil"
          },
          "buttons": {
            "submit": "Enviar",
            "cancel": "Cancelar",
            "save": "Guardar"
          }
        }
      },
      ja: {
        translation: {
          "welcome": "AFAIへようこそ！",
          "signInPrompt": "AFAIクライアントのメールでサインインしてください",
          "signIn": "サインイン",
          "loadingUser": "ユーザー情報を読み込んでいます...",
          "navigation": {
            "home": "ホーム",
            "profile": "プロフィール"
          },
          "buttons": {
            "submit": "送信",
            "cancel": "キャンセル",
            "save": "保存"
          }
        }
      },
      tr: {
        translation: {
          "welcome": "AFAI'ye Hoş Geldiniz!",
          "signInPrompt": "Lütfen AFAI müşteri e-postanızla giriş yapın",
          "signIn": "Giriş Yap",
          "loadingUser": "Kullanıcı bilgileri yükleniyor...",
          "navigation": {
            "home": "Ana Sayfa",
            "profile": "Profil"
          },
          "buttons": {
            "submit": "Gönder",
            "cancel": "İptal",
            "save": "Kaydet"
          }
        }
      }
    },
    
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    interpolation: {
      escapeValue: false
    }
  });


export default i18n;