import React from 'react'

import logo from "../assets/logo3.png"
import { LanguageSelector } from './LanguageSelector'
import { useAuthStore } from '../stores/authStore'
 
const Header = () => {

  const { user } = useAuthStore()
  return (
    <div className='flex items-center justify-between px-8 py-4 border-b'>
      <img 
        src={logo}
        alt=''
        className='w-20 h-20'
      />
      {user?.id}
      <LanguageSelector />
    </div>
  )
}

export default Header