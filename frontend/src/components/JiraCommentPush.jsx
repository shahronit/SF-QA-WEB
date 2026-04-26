import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useJira } from '../context/JiraContext'
import { useSessionPrefs } from '../context/SessionPrefsContext'
import { extractClarificationBlock } from '../utils/extractClarificationBlock'

const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i
const AGENTS = new Set(['requirement', 'exec_report', 'closure_report'])

function defaultCommentBody(markdown, agentName) {
  if (!markdown?.trim()) return ''
  if (agentName === 'requirement') {
    const block = extractClarificationBlock(markdown)
    return (block && block.trim()) ? block : markdown
  }
  return markdown
}

export default function JiraCommentPush({ markdown, agentName, defaultIssueKey = '' }) {
  const { connected: jiraConnected } = useJira()
  const { userStoryKey: pinnedStoryKey, setUserStoryKey } = useSessionPrefs()
  const [open, setOpen] = useState(false)
  const [issueKey, setIssueKey] = useState('')
  const [body, setBody] = useState('')
  const [pushing, setPushing] = useState(false)

  if (!AGENTS.has(agentName)) return null

  const openModal = useCallback(() => {
    if (!jiraConnected) {
      toast.error('Connect to Jira from the Hub first.')
      return
    }
    if (!markdown?.trim()) {
      toast.error('No content to post yet.')
      return
    }
    // Seed order: explicit defaultIssueKey from caller > persistent
    // userStoryKey pin > empty. The pin is what makes "comment on Jira"
    // pre-fill with the same parent ticket the user picked anywhere else.
    const seed = (defaultIssueKey || '').trim() || (pinnedStoryKey || '').trim()
    setIssueKey(seed)
    setBody(defaultCommentBody(markdown, agentName))
    setOpen(true)
  }, [jiraConnected, markdown, agentName, defaultIssueKey, pinnedStoryKey])

  const closeModal = () => {
    setOpen(false)
  }

  const submit = async () => {
    const key = issueKey.trim()
    if (!JIRA_KEY_RE.test(key)) {
      toast.error('Enter a valid Jira issue key (e.g. PROJ-123).')
      return
    }
    if (!body.trim()) {
      toast.error('Comment cannot be empty.')
      return
    }
    setPushing(true)
    try {
      const { data } = await api.post('/jira/comment', { issue_key: key, body: body.trim() })
      const id = data?.id
      toast.success(
        id ? `Comment added on ${data.issue_key || key} (id ${id})` : `Comment added on ${data?.issue_key || key}`,
      )
      closeModal()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to add Jira comment.')
    } finally {
      setPushing(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title={!jiraConnected ? 'Connect Jira from the Hub first' : 'Post a comment on a Jira issue'}
        disabled={!markdown?.trim()}
        className={`toon-btn text-sm py-2 px-4 ${
          jiraConnected && markdown?.trim()
            ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white hover:opacity-90'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        }`}
      >
        💬 Comment on Jira
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ zIndex: 9999 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={closeModal}
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className="bg-white rounded-toon-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
                  <div>
                    <h3 className="font-extrabold text-toon-navy text-lg">Comment on Jira ticket</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Edit the text before posting. Requirements analysis defaults to the clarifying-questions section when found.
                    </p>
                  </div>
                  <button type="button" onClick={closeModal} className="text-gray-400 hover:text-toon-coral text-2xl leading-none">×</button>
                </div>

                <div className="flex-1 overflow-auto p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-toon-navy mb-1">Issue key</label>
                    <input
                      className="toon-input !py-2 w-full"
                      value={issueKey}
                      onChange={e => {
                        const v = e.target.value.toUpperCase()
                        setIssueKey(v)
                        // Pin the user's choice so the next Jira-push
                        // surface (test mgmt, bug push) defaults to it.
                        if (JIRA_KEY_RE.test(v.trim())) setUserStoryKey(v.trim())
                      }}
                      placeholder="PROJ-123"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-toon-navy mb-1">Comment</label>
                    <textarea
                      className="toon-input !py-2 w-full min-h-[220px] font-mono text-sm"
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      placeholder="Markdown is supported; it is converted for Jira."
                    />
                  </div>
                </div>

                <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="toon-btn bg-gray-100 text-gray-700 text-sm py-2 px-4">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={pushing}
                    className="toon-btn toon-btn-blue text-sm py-2 px-4 disabled:opacity-60"
                  >
                    {pushing ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
