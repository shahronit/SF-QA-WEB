import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import ToonCard from '../components/ToonCard'
import JiraConnector from '../components/JiraConnector'
import logo from '../assets/logo.png'
import FloatingShapes from '../components/motion/FloatingShapes'
import { Stagger, StaggerItem } from '../components/motion/Stagger'
import { Mascot } from '../components/mascots'

const utilityTiles = [
  { path: '/projects', icon: '📂', title: 'Projects', desc: 'Manage project docs & scope', gradient: 'from-toon-blue to-sky-500', shadow: 'shadow-toon' },
  { path: '/history', icon: '📜', title: 'History', desc: 'Review past agent runs', gradient: 'from-violet-500 to-purple-400', shadow: 'shadow-toon-purple' },
]

const phaseSections = [
  {
    phase: 'Manual QA',
    accent: 'from-blue-500 to-indigo-500',
    mascot: 'DesignMascot',
    tiles: [
      { path: '/requirements',   icon: '📝', title: 'Requirements Analysis',   desc: 'User stories → risks, objects, acceptance criteria', gradient: 'from-blue-600 to-blue-500',      shadow: 'shadow-toon' },
      { path: '/test-plan',      icon: '📋', title: 'Test Plan & Strategy',    desc: 'IEEE 829-aligned strategy + formal test plan',       gradient: 'from-cyan-500 to-teal-500',     shadow: 'shadow-toon-mint' },
      { path: '/testcases',      icon: '🧪', title: 'Test Case Development',   desc: 'Positive, negative, bulk & edge cases',              gradient: 'from-toon-mint to-emerald-400', shadow: 'shadow-toon-mint' },
      { path: '/smoke',          icon: '💨', title: 'Smoke Test Execution',    desc: 'Post-release build validation',                      gradient: 'from-orange-400 to-toon-yellow', shadow: 'shadow-toon-yellow' },
      { path: '/regression',     icon: '🔄', title: 'Regression Testing',      desc: 'Change impact analysis',                             gradient: 'from-toon-navy to-blue-700',    shadow: 'shadow-toon' },
      { path: '/bugs',           icon: '🐛', title: 'Defect Reports',          desc: 'AI-assisted bug reports → Jira',                     gradient: 'from-toon-coral to-red-400',    shadow: 'shadow-toon-coral' },
      { path: '/closure-report', icon: '🏁', title: 'Test Closure Report',     desc: 'End-of-cycle sign-off report',                       gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-toon-purple' },
    ],
  },
  {
    phase: 'Advanced QA Agents',
    accent: 'from-violet-500 to-fuchsia-500',
    mascot: 'PlanningMascot',
    tiles: [
      { path: '/estimation',       icon: '📊', title: 'Test Effort Estimation',     desc: 'Multi-technique effort & buffer',                         gradient: 'from-toon-purple to-violet-400', shadow: 'shadow-toon-purple' },
      { path: '/automation-plan',  icon: '🤖', title: 'Test Automation Plan',       desc: 'Framework, CI/CD & ROI',                                  gradient: 'from-rose-500 to-pink-500',      shadow: 'shadow-toon-coral' },
      { path: '/test-data',        icon: '🧬', title: 'Test Data Preparation',      desc: 'CSV / SOQL / JSON / Apex factories',                      gradient: 'from-emerald-500 to-teal-500',   shadow: 'shadow-toon-mint' },
      { path: '/rtm',              icon: '🧭', title: 'Requirements Traceability',  desc: 'Requirements ↔ test ↔ defect coverage',                   gradient: 'from-sky-500 to-cyan-500',       shadow: 'shadow-toon' },
      { path: '/copado-scripts',   icon: '⚡', title: 'Automation Scripts',         desc: 'Playwright, Cypress, Selenium, Robot Framework, Copado…', gradient: 'from-amber-500 to-orange-600',   shadow: 'shadow-toon-yellow' },
      { path: '/uat-plan',         icon: '🤝', title: 'UAT Plan & Sign-off',        desc: 'Business acceptance scenarios',                           gradient: 'from-fuchsia-500 to-pink-500',   shadow: 'shadow-toon-coral' },
      { path: '/execution-report', icon: '📈', title: 'Test Execution Report',      desc: 'Cycle metrics & Go/No-Go',                                gradient: 'from-orange-500 to-red-500',     shadow: 'shadow-toon-coral' },
      { path: '/rca',              icon: '🔍', title: 'Root Cause Analysis',        desc: '5-Whys + Fishbone + actions',                             gradient: 'from-rose-500 to-red-600',       shadow: 'shadow-toon-coral' },
      { path: '/stlc-pack',        icon: '🚀', title: '1-click STLC Pack',          desc: 'Run the full STLC end-to-end from a Jira ticket',         gradient: 'from-violet-500 to-fuchsia-500', shadow: 'shadow-toon-purple' },
    ],
  },
]

export default function Hub() {
  const nav = useNavigate()

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-toon-navy via-blue-600 to-toon-blue rounded-toon-lg p-8 mb-8 text-white relative overflow-hidden"
      >
        <FloatingShapes count={5} palette="light" opacity={0.18} minSize={140} maxSize={320} />
        <div className="relative z-10 flex items-center gap-5">
          <motion.img
            src={logo}
            className="w-16 h-16 rounded-2xl bg-white/20 p-2 shadow-lg"
            animate={{ y: [0, -6, 0], rotate: [0, -3, 3, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          />
          <div>
            <motion.h1
              className="text-2xl font-extrabold"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
            >
              QA Studio
            </motion.h1>
            <motion.p
              className="opacity-90 mt-1"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 0.9, x: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
            >
              AI-powered test artifacts for QA teams
            </motion.p>
          </div>
        </div>
        <Stagger className="flex flex-wrap gap-3 mt-5 relative z-10" delayChildren={0.3} staggerChildren={0.07}>
          {['7 Manual + 9 Advanced Agents', 'STLC End-to-End', 'RAG Grounded', 'Agent Chaining'].map(label => (
            <StaggerItem key={label}>
              <motion.span
                whileHover={{ scale: 1.05, y: -2 }}
                className="inline-block bg-white/15 backdrop-blur px-4 py-1.5 rounded-xl text-sm font-semibold border border-white/20"
              >
                {label}
              </motion.span>
            </StaggerItem>
          ))}
        </Stagger>
      </motion.div>

      <div className="mb-6">
        <JiraConnector />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ y: -4 }}
        onClick={() => nav('/stlc-pack')}
        className="cursor-pointer mb-8 relative overflow-hidden rounded-toon-lg bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white p-6 shadow-toon-purple"
      >
        <FloatingShapes count={4} palette="light" opacity={0.18} minSize={120} maxSize={260} />
        <div className="relative z-10 flex items-center gap-5">
          <motion.div
            className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-3xl shadow-md"
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          >
            🚀
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] font-bold opacity-90">New</div>
            <h3 className="text-xl font-extrabold">1-click STLC Pack</h3>
            <p className="text-sm opacity-90 mt-0.5">
              Generate the full STLC report from a Jira ticket or user story — Requirements, Plan, Cases, Execution &amp; Closure in one run.
            </p>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <div className="text-[11px] uppercase tracking-wider opacity-80">5 agents · chained</div>
            <motion.span
              whileHover={{ scale: 1.05 }}
              className="bg-white/20 px-3 py-1 rounded-xl text-sm font-bold border border-white/30"
            >
              Try it →
            </motion.span>
          </div>
        </div>
      </motion.div>

      <h2 className="text-lg font-extrabold text-toon-navy mb-4 flex items-center gap-2">
        <span>Workspace</span>
        <span className="flex-1 h-0.5 bg-gradient-to-r from-toon-blue/20 to-transparent rounded" />
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {utilityTiles.map((tile, i) => (
          <ToonCard key={tile.path} delay={i * 0.05} onClick={() => nav(tile.path)} className="cursor-pointer">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tile.gradient} flex items-center justify-center text-white text-lg mb-3 ${tile.shadow}`}>
              {tile.icon}
            </div>
            <h3 className="font-bold text-toon-navy">{tile.title}</h3>
            <p className="text-sm text-gray-500 mt-1">{tile.desc}</p>
          </ToonCard>
        ))}
      </div>

      {phaseSections.filter(s => s.phase === 'Manual QA').map((section) => (
        <motion.div
          key={section.phase}
          className="mb-10 relative"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-toon-navy flex items-center gap-3">
              <span className={`w-2 h-6 rounded-full bg-gradient-to-b ${section.accent}`} />
              <span>{section.phase}</span>
            </h2>
            <div className="opacity-70 hidden sm:block">
              <Mascot name={section.mascot} size={48} />
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-toon-blue/15 via-transparent to-transparent mb-4" />
          <Stagger
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            delayChildren={0.05}
            staggerChildren={0.05}
          >
            {section.tiles.map((tile) => (
              <StaggerItem key={tile.path}>
                <motion.div
                  whileHover={{ rotateZ: -1, y: -6, scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                  onClick={() => nav(tile.path)}
                  className="toon-card cursor-pointer h-full"
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tile.gradient} flex items-center justify-center text-white text-lg mb-3 ${tile.shadow}`}>
                    {tile.icon}
                  </div>
                  <h3 className="font-bold text-toon-navy">{tile.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{tile.desc}</p>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.4 }}
        className="rounded-toon-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-200 p-4 flex items-center gap-3 text-sm"
      >
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-base shadow-toon-purple">
          ⚙️
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-toon-navy">Looking for advanced agents?</div>
          <div className="text-gray-500 text-xs">
            Effort Estimation, Automation Plan, Test Data, RTM, Automation Scripts, UAT, Execution Report, RCA, and the 1-click STLC Pack are available from the sidebar.
          </div>
        </div>
      </motion.div>
    </div>
  )
}
