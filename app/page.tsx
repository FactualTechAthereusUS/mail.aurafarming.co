'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Mail, 
  Inbox, 
  Send, 
  Star, 
  Archive,
  Trash,
  Plus,
  Search,
  Settings,
  User,
  PaperclipIcon,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  LogOut,
  Filter,
  MoreHorizontal,
  Edit3,
  Trash2
} from 'lucide-react'
import ComposeEmail from '@/components/ComposeEmail'

// Types
interface Email {
  id: number
  from_email: string
  to_email: string
  subject: string
  body: string
  is_read: boolean
  has_attachments: boolean
  created_at: string
  priority: 'low' | 'normal' | 'high'
  starred: boolean
  folder: string
}

interface User {
  id: number
  email: string
  username: string
  full_name?: string
}

const API_URL = 'https://api.aurafarming.co'

export default function WebmailPage() {
  const [user, setUser] = useState<User | null>(null)
  const [emails, setEmails] = useState<Email[]>([])
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [activeFolder, setActiveFolder] = useState('inbox')
  const [isComposing, setIsComposing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [loginMode, setLoginMode] = useState(true)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)

  // FIXED: Fetch emails function with folder-specific endpoints
  const fetchEmails = useCallback(async (userId?: number, authToken?: string) => {
    const actualUserId = userId || user?.id
    const actualToken = authToken || token
    
    if (!actualUserId || !actualToken) {
      console.log('❌ Missing user ID or token for email fetch')
      return
    }
    
    setIsLoading(true)
    try {
      console.log(`📬 Fetching emails for folder: ${activeFolder}, user: ${actualUserId}`)
      
      // Use correct API endpoints
      let endpoint = `${API_URL}/api/emails/${activeFolder}/${actualUserId}`; // All folders use the same pattern now
      
      console.log(`🔑 Using token: ${actualToken?.substring(0, 20)}...`)
      console.log(`📡 Calling endpoint: ${endpoint}`)
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${actualToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log(`✅ Fetched ${data.emails?.length || 0} emails for ${activeFolder}`)
        
        let filteredEmails = data.emails || [];
        
        // FIXED: Apply folder-specific filtering
        if (activeFolder === 'starred') {
          filteredEmails = filteredEmails.filter((email: Email) => email.starred);
        } else if (activeFolder === 'archive') {
          filteredEmails = filteredEmails.filter((email: Email) => email.folder === 'archive');
        } else if (activeFolder === 'trash') {
          filteredEmails = filteredEmails.filter((email: Email) => email.folder === 'trash');
        }
        
        setEmails(filteredEmails)
        
        // Show notification for new emails (only for inbox)
        if (activeFolder === 'inbox' && filteredEmails && filteredEmails.length > emails.length) {
          console.log('🔔 New emails detected!')
        }
      } else {
        const errorData = await response.text()
        console.error('❌ Failed to fetch emails:', response.status, errorData)
        setError(`Failed to load ${activeFolder}. Please try logging in again.`)
      }
    } catch (error) {
      console.error('❌ Network error fetching emails:', error)
      setError('Network error. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }, [activeFolder, user?.id, token, emails.length])

  // Auto-refresh emails
  useEffect(() => {
    if (!user || !token) {
      console.log('❌ No user or token for auto-refresh')
      return
    }
    
    console.log('🔄 Setting up auto-refresh interval')
    // Initial fetch
    fetchEmails(user.id, token)
    
    const interval = setInterval(() => {
      console.log('⏰ Auto-refreshing emails...')
      fetchEmails(user.id, token)
    }, 3000) // Every 3 seconds for faster updates
    
    return () => {
      console.log('🛑 Clearing auto-refresh interval')
      clearInterval(interval)
    }
  }, [user, token, fetchEmails])

  // Login function
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      })
      
      const data = await response.json()
      
      if (data.success) {
        setToken(data.token)
        setUser(data.user)
        localStorage.setItem('auramail_token', data.token)
        localStorage.setItem('auramail_user', JSON.stringify(data.user))
        setLoginMode(false)
        fetchEmails(data.user.id, data.token)
      } else {
        alert(data.error)
      }
    } catch (error) {
      console.error('Login error:', error)
      alert('Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Check for existing login on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('auramail_token')
    const savedUser = localStorage.getItem('auramail_user')
    
    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser)
        setToken(savedToken)
        setUser(parsedUser)
        setLoginMode(false)
        fetchEmails(parsedUser.id, savedToken)
      } catch (error) {
        console.error('Failed to parse saved user:', error)
        localStorage.removeItem('auramail_token')
        localStorage.removeItem('auramail_user')
      }
    }
  }, [])

  // Send email function
  const handleSendEmail = async (emailData: {
    to: string
    subject: string
    body: string
    priority: 'low' | 'normal' | 'high'
    attachments?: File[]
  }) => {
    if (!token) return

    // FIXED: Send JSON instead of FormData to match backend
    const emailPayload = {
      to: emailData.to,
      subject: emailData.subject,
      body: emailData.body,
      priority: emailData.priority,
      from_user: user?.email || 'noreply@aurafarming.co' // Use logged-in user's email
      // Note: Attachments will be added in a future update
    }

    try {
      const response = await fetch(`${API_URL}/api/emails/send`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailPayload)
      })

      if (response.ok) {
        const data = await response.json()
        console.log('✅ Email sent:', data)
        setIsComposing(false)
        // Refresh sent folder if active, otherwise just inbox
        if (activeFolder === 'sent') {
          fetchEmails()
        }
      } else {
        const errorData = await response.text()
        console.error('❌ Failed to send email:', errorData)
        alert('Failed to send email. Please try again.')
      }
    } catch (error) {
      console.error('❌ Network error sending email:', error)
      alert('Network error. Please check your connection and try again.')
    }
  }

  // Star/unstar email
  const handleStarEmail = async (emailId: number, starred: boolean) => {
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/api/emails/${emailId}/star`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ starred })
      })

      if (response.ok) {
        // Update email in state
        setEmails(emails.map(email => 
          email.id === emailId ? { ...email, starred } : email
        ))
      } else {
        console.error('Failed to star email')
      }
    } catch (error) {
      console.error('Network error starring email:', error)
    }
  }

  // Archive email
  const handleArchiveEmail = async (emailId: number) => {
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/api/emails/${emailId}/archive`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        // Remove email from current view
        setEmails(emails.filter(email => email.id !== emailId))
        setSelectedEmail(null)
      } else {
        console.error('Failed to archive email')
      }
    } catch (error) {
      console.error('Network error archiving email:', error)
    }
  }

  // Delete email
  const handleDeleteEmail = async (emailId: number) => {
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/api/emails/${emailId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        // Remove email from current view
        setEmails(emails.filter(email => email.id !== emailId))
        setSelectedEmail(null)
      } else {
        console.error('Failed to delete email')
      }
    } catch (error) {
      console.error('Network error deleting email:', error)
    }
  }

  // Mark email as read
  const handleMarkAsRead = async (emailId: number) => {
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/api/emails/${emailId}/read`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        // Update email in state
        setEmails(emails.map(email => 
          email.id === emailId ? { ...email, is_read: true } : email
        ))
      } else {
        console.error('Failed to mark email as read')
      }
    } catch (error) {
      console.error('Network error marking email as read:', error)
    }
  }

  // Logout function
  const handleLogout = () => {
    setUser(null)
    setToken(null)
    setEmails([])
    setSelectedEmail(null)
    setLoginMode(true)
    localStorage.removeItem('auramail_token')
    localStorage.removeItem('auramail_user')
  }

  // Sidebar item component
  interface SidebarItemProps {
    icon: React.ReactNode
    label: string
    count?: number
    isSelected?: boolean
    onClick?: () => void
  }

  const SidebarItem: React.FC<SidebarItemProps> = ({ 
    icon, 
    label, 
    count, 
    isSelected = false, 
    onClick 
  }) => {
    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={`
          flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer
          ${isSelected ? 'bg-[#1A1A1A] text-white' : 'text-gray-400 hover:bg-[#1A1A1A] hover:text-white'}
        `}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="px-2 py-1 text-xs font-medium bg-blue-500 text-white rounded-full">
            {count}
          </span>
        )}
      </motion.div>
    )
  }

  // Sidebar component
  const Sidebar = () => (
    <div className="w-64 bg-black border-r border-[#1A1A1A] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-3 px-4 py-2 mb-4">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
          <Mail className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-white font-semibold">AuraMail</h1>
          <p className="text-xs text-gray-400">Professional email experience</p>
        </div>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setIsComposing(true)}
        className="w-full bg-blue-500 text-white rounded-lg py-3 px-4 flex items-center gap-2 mb-4"
      >
        <Plus className="w-5 h-5" />
        Compose
      </motion.button>

      <div className="space-y-1">
        <SidebarItem
          icon={<Inbox className="w-5 h-5" />}
          label="Inbox"
          count={emails.filter(e => !e.is_read && e.folder === 'inbox').length}
          isSelected={activeFolder === 'inbox'}
          onClick={() => setActiveFolder('inbox')}
        />
        <SidebarItem
          icon={<Send className="w-5 h-5" />}
          label="Sent"
          isSelected={activeFolder === 'sent'}
          onClick={() => setActiveFolder('sent')}
        />
        <SidebarItem
          icon={<Star className="w-5 h-5" />}
          label="Starred"
          count={emails.filter(e => e.starred).length}
          isSelected={activeFolder === 'starred'}
          onClick={() => setActiveFolder('starred')}
        />
        <SidebarItem
          icon={<Archive className="w-5 h-5" />}
          label="Archive"
          isSelected={activeFolder === 'archive'}
          onClick={() => setActiveFolder('archive')}
        />
        <SidebarItem
          icon={<Trash className="w-5 h-5" />}
          label="Trash"
          isSelected={activeFolder === 'trash'}
          onClick={() => setActiveFolder('trash')}
        />
      </div>

      <div className="mt-auto">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleLogout}
          className="w-full text-gray-400 hover:text-white rounded-lg py-2 px-4 flex items-center gap-2"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </motion.button>
      </div>
    </div>
  )

  // Email list component
  const EmailList = () => (
    <div className="w-80 bg-black border-r border-[#1A1A1A] overflow-y-auto">
      <div className="p-4 border-b border-[#1A1A1A]">
        <div className="flex items-center gap-2 bg-[#1A1A1A] rounded-lg px-4 py-2">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search emails..."
            className="bg-transparent text-white placeholder-gray-400 focus:outline-none w-full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="divide-y divide-[#1A1A1A]">
        {emails.map((email) => (
          <motion.div
            key={email.id}
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedEmail(email)}
            className={`
              p-4 cursor-pointer transition-colors
              ${selectedEmail?.id === email.id ? 'bg-[#1A1A1A]' : 'hover:bg-[#1A1A1A]'}
              ${!email.is_read ? 'bg-opacity-50' : ''}
            `}
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white font-medium">
                  {email.from_email[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-gray-400 text-sm truncate">
                    {email.from_email}
                  </p>
                  <span className="text-gray-600 text-xs">
                    {new Date(email.created_at).toLocaleDateString()}
                  </span>
                </div>
                <h3 className={`text-sm mb-1 truncate ${!email.is_read ? 'text-white font-medium' : 'text-gray-400'}`}>
                  {email.subject}
                </h3>
                <p className="text-gray-600 text-sm truncate">
                  {email.body.replace(/<[^>]*>/g, '')}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )

  // Email view component
  const EmailView = () => (
    <div className="flex-1 bg-black overflow-y-auto">
      {selectedEmail ? (
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-white mb-3">{selectedEmail?.subject || 'No Subject'}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span>From: {selectedEmail?.from_email || 'Unknown'}</span>
                <span>To: {selectedEmail?.to_email || 'Unknown'}</span>
                <span>{selectedEmail?.created_at ? new Date(selectedEmail.created_at).toLocaleString() : 'Unknown Date'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => selectedEmail?.id && handleStarEmail(selectedEmail.id, !selectedEmail.starred)}
                className="p-2 hover:bg-[#1A1A1A] rounded text-gray-400 hover:text-white"
              >
                <Star className={`w-4 h-4 ${selectedEmail?.starred ? 'text-yellow-500 fill-current' : ''}`} />
              </button>
              <button 
                onClick={() => selectedEmail?.id && handleArchiveEmail(selectedEmail.id)}
                className="p-2 hover:bg-[#1A1A1A] rounded text-gray-400 hover:text-white"
              >
                <Archive className="w-4 h-4" />
              </button>
              <button 
                onClick={() => selectedEmail?.id && handleDeleteEmail(selectedEmail.id)}
                className="p-2 hover:bg-[#1A1A1A] rounded text-gray-400 hover:text-white"
              >
                <Trash className="w-4 h-4" />
              </button>
            </div>
          </div>

          {selectedEmail?.body ? (
            <div 
              className="email-html-content"
              dangerouslySetInnerHTML={{ 
                __html: (() => {
                  let htmlContent = selectedEmail.body;
                  
                  // FIRST: Fix broken HTML tags that got corrupted during email parsing
                  htmlContent = htmlContent
                    // Fix broken MSO conditional comments
                    .replace(/<=?\s*!-?\[if\s+mso[^\]]*\]>?/gi, '<!--[if mso]>')
                    .replace(/<=?\s*!-?\[if\s+[^\]]*\]>?/gi, '<!--[if IE]>')
                    .replace(/<!\[endif\]-?>/gi, '<![endif]-->')
                    
                    // Fix broken HTML tags (like <= tbody> should be <tbody>)
                    .replace(/<=\s*([a-zA-Z][^>]*>)/g, '<$1')
                    .replace(/<=\s*\/([a-zA-Z][^>]*>)/g, '</$1')
                    
                    // Fix encoding issues
                    .replace(/â€™/g, "'")
                    .replace(/â€œ/g, '"')
                    .replace(/â€/g, '"')
                    .replace(/â€¦/g, '...')
                    .replace(/â€"/g, '—');
                  
                  // SECOND: Extract the body content (the REAL email)
                  let bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                  if (bodyMatch) {
                    htmlContent = bodyMatch[1];
                  } else {
                    // If no body tag, look for main content table
                    let tableMatch = htmlContent.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
                    if (tableMatch) {
                      htmlContent = tableMatch[1];
                    }
                  }
                  
                  // THIRD: Clean up only the unnecessary parts but keep the real content
                  htmlContent = htmlContent
                    // Remove only inline styles and scripts, keep structure
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    // Clean up extra whitespace
                    .replace(/\s+/g, ' ')
                    .trim();
                  
                  // EXTRACT THE REAL CLAUDE.AI LINK FOR THE USER
                  const linkMatch = htmlContent.match(/href=["']([^"']*claude[^"']*)["']/i);
                  if (linkMatch) {
                    console.log('🔗 REAL CLAUDE.AI LINK FOUND:', linkMatch[1]);
                    // Also display it in the email for easy access
                    htmlContent += `
                      <div style="margin-top: 20px; padding: 15px; background: #e8f4f8; border-radius: 8px; border-left: 4px solid #1a73e8;">
                        <strong>🔗 Direct Link:</strong><br/>
                        <a href="${linkMatch[1]}" target="_blank" style="color: #1a73e8; word-break: break-all;">
                          ${linkMatch[1]}
                        </a>
                      </div>
                    `;
                  }
                  
                  return htmlContent || '<p>Email content could not be displayed.</p>';
                })()
              }}
              onClick={(e) => {
                // Handle link clicks to open in new window/tab
                const target = e.target as HTMLElement;
                if (target.tagName === 'A' || target.closest('a')) {
                  const link = target.tagName === 'A' ? target as HTMLAnchorElement : target.closest('a') as HTMLAnchorElement;
                  if (link && link.href) {
                    e.preventDefault();
                    window.open(link.href, '_blank', 'noopener,noreferrer');
                  }
                }
              }}
              style={{
                backgroundColor: 'white',
                color: '#202124',
                padding: '24px',
                borderRadius: '12px',
                fontFamily: 'Google Sans, Roboto, Arial, sans-serif',
                lineHeight: '1.6',
                maxWidth: '100%',
                overflow: 'hidden',
                cursor: 'default',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                border: '1px solid #e8eaed',
                minHeight: '200px'
              }}
            />
          ) : (
            // Render plain text email with preserved line breaks
            <div className="text-gray-200 whitespace-pre-wrap text-sm leading-relaxed" style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>
              No content available
            </div>
          )}
        </div>
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-gray-400">
          <Mail className="w-16 h-16 mb-4 opacity-20" />
          <p>No email selected</p>
          <p className="text-sm">Choose an email from the list to read</p>
        </div>
      )}
    </div>
  )

  // Login form
  if (loginMode) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-[#1A1A1A] p-8 rounded-2xl w-full max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
              <Mail className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white">AuraMail</h1>
              <p className="text-gray-400">Professional email experience</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Email
              </label>
              <input
                type="email"
                value={credentials.email}
                onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
                className="w-full bg-black border border-[#333] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Password
              </label>
              <input
                type="password"
                value={credentials.password}
                onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                className="w-full bg-black border border-[#333] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-500 text-white rounded-lg py-2 font-medium hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#1A1A1A] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex">
      <Sidebar />
      <EmailList />
      <EmailView />
      
      <AnimatePresence>
        {isComposing && (
          <ComposeEmail
            isOpen={isComposing}
            onClose={() => setIsComposing(false)}
            onSend={handleSendEmail}
            token={token || ''}
          />
        )}
      </AnimatePresence>
    </div>
  )
}