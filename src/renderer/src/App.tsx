import { Button } from "./components/ui/button"
import { Route, BrowserRouter as Router, Routes } from "react-router"
import Home from "./pages/Home"
import { useEffect } from "react";
import { initializeAuthListener, useAuthStore } from "./stores/authStore";
import { Loader2Icon } from "lucide-react";
import { cn } from "./lib/utils";
import Profile from "./pages/Profile";
import { useTranslation } from "react-i18next";
import './lib/i18n'
import { LanguageSelector } from "./components/LanguageSelector";
import logo from "./assets/logo3.png"
import Header from "./components/Header";

function App(): JSX.Element {
  useEffect(() => {
    const unsubscribe = initializeAuthListener();
    return () => unsubscribe();
  }, []);
  
  const { user, isLoading, signInWithGoogle } = useAuthStore();
  const { t } = useTranslation();
  
  if(!user) {
    return (
      <div className={cn({
        "w-full h-full flex flex-col gap-4 items-center justify-center": true,
        "relative opacity-45 pointer-events-none": isLoading
      })}>
        <LanguageSelector />
        <img 
          src={logo}
          alt=""
          className="w-24 h-24"
        />
        <p>{t('welcome')}</p>
        <p>{t('signInPrompt')}</p>
        <Button className="w-1/4" onClick={signInWithGoogle}>{t('signIn')}</Button>
        {isLoading && <Loader2Icon className="absolute right-1/2 top-1/2 animate-spin"/>}
      </div>
    );
  }
  
  if(isLoading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <Loader2Icon className="animate-spin"/>
        <p>{t('loadingUser')}</p>
      </div>
    );
  }
  
  return (
    <div className='w-full'>
      <Header />
      <Router>
        <Routes>
          <Route path="/" element={<Home />}/>
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;