import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import JiraConnector from '../components/JiraConnector'
import { Stagger, StaggerItem } from '../components/motion/Stagger'
import AuroraBg from '../components/motion/AuroraBg'
import Tilt3D from '../components/motion/Tilt3D'
import Icon3D from '../components/icons/Icon3D'
import { useAuth } from '../context/AuthContext'
import { userCanAccessPath } from '../config/agentMeta'

const utilityTiles = [
  { path: '/projects', iconKey3d: 'folder',  title: 'Projects', desc: 'Manage project docs & scope' },
  { path: '/history',  iconKey3d: 'history', title: 'History',  desc: 'Review past agent runs' },
]

const phaseSections = [
  {
    phase: 'Manual QA',
    iconKey3d: 'testcase',
    accent: 'from-astound-violet to-astound-cyan',
    tiles: [
      { path: '/requirements',   iconKey3d: 'requirement',    title: 'Requirements Analysis',           desc: 'User stories → risks, objects, acceptance criteria' },
      { path: '/test-plan',      iconKey3d: 'test_plan',      title: 'Test Plan & Strategy',            desc: 'IEEE 829-aligned strategy + formal test plan' },
      { path: '/testcases',      iconKey3d: 'testcase',       title: 'Test Case Development',           desc: 'Positive, negative, bulk & edge cases' },
      { path: '/smoke',          iconKey3d: 'smoke',          title: 'Smoke Test Plan - Checklist',     desc: 'Post-release build validation' },
      { path: '/regression',     iconKey3d: 'regression',     title: 'Regression Test Plan - Checklist',desc: 'Change impact analysis' },
      { path: '/bugs',           iconKey3d: 'bug_report',     title: 'Defect Reports',                  desc: 'AI-assisted bug reports → Jira' },
      { path: '/closure-report', iconKey3d: 'closure_report', title: 'Test Closure Report',             desc: 'End-of-cycle sign-off report' },
    ],
  },
  {
    phase: 'Advanced QA Agents',
    iconKey3d: 'sparkles',
    accent: 'from-astound-magenta to-astound-violet',
    tiles: [
      { path: '/estimation',       iconKey3d: 'estimation',      title: 'Test Effort Estimation',     desc: 'Multi-technique effort & buffer' },
      { path: '/automation-plan',  iconKey3d: 'automation_plan', title: 'Test Automation Plan',       desc: 'Framework, CI/CD & ROI' },
      { path: '/test-data',        iconKey3d: 'test_data',       title: 'Test Data Preparation',      desc: 'CSV / SOQL / JSON / Apex factories' },
      { path: '/rtm',              iconKey3d: 'rtm',             title: 'Requirements Traceability',  desc: 'Requirements ↔ test ↔ defect coverage' },
      { path: '/copado-scripts',   iconKey3d: 'copado_script',   title: 'Automation Scripts',         desc: 'Playwright, Cypress, Selenium, Robot Framework, Copado…' },
      { path: '/uat-plan',         iconKey3d: 'uat_plan',        title: 'UAT Plan & Sign-off',        desc: 'Business acceptance scenarios' },
      { path: '/execution-report', iconKey3d: 'exec_report',     title: 'Test Execution Report',      desc: 'Cycle metrics & Go/No-Go' },
      { path: '/rca',              iconKey3d: 'rca',             title: 'Root Cause Analysis',        desc: '5-Whys + Fishbone + actions' },
      { path: '/stlc-pack',        iconKey3d: 'stlc_pack',       title: '1-click STLC Pack',          desc: 'Run the full STLC end-to-end from a Jira ticket' },
    ],
  },
]

// Sidebar group ids the per-section visibility toggles map to.
const SECTION_TO_VISIBILITY_KEY = {
  'Manual QA': 'manual',
  'Advanced QA Agents': 'advanced',
}

export default function Hub() {
  const nav = useNavigate()
  const { user } = useAuth()

  // Apply the same filter the Sidebar uses so the Hub stays in sync.
  // Sections hidden via menu_visibility disappear; individual tiles
  // outside agent_access disappear too. Admins see everything.
  const visibleSections = phaseSections
    .filter(section => {
      if (!user || user.is_admin) return true
      const key = SECTION_TO_VISIBILITY_KEY[section.phase]
      if (!key) return true
      return user.menu_visibility?.[key] !== false
    })
    .map(section => ({
      ...section,
      tiles: section.tiles.filter(tile => userCanAccessPath(user, tile.path)),
    }))
    .filter(section => section.tiles.length > 0)

  // Hide the STLC Pack hero card when the user has no access to it
  // (it's just a shortcut to /stlc-pack — a 403 on click would be
  // worse UX than removing the card).
  const showStlcHero = userCanAccessPath(user, '/stlc-pack')

  // Hide the "Looking for advanced agents?" callout when the user
  // doesn't have access to the Advanced section. They can't reach
  // those agents anyway so the callout is just noise.
  const showAdvancedCallout = !!user && (
    user.is_admin || user.menu_visibility?.advanced !== false
  )

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-toon-lg p-8 mb-8 text-white relative overflow-hidden bg-astound-deep"
      >
        <AuroraBg intensity="full" />
        <div className="relative z-10 flex items-center gap-4">
          <span className="astound-pill bg-white/10 text-white border-white/20">
            <Icon3D name="sparkles" size={14} float />
            QA Studio · Astound Digital
          </span>
        </div>
        <h1 className="font-display text-4xl lg:text-5xl font-extrabold mt-4 leading-tight relative z-10">
          Choose your <span className="astound-text-grad">QA Workflow</span>
        </h1>
        <p className="mt-3 text-white/75 max-w-2xl text-sm lg:text-base relative z-10">
          End-to-end test artefacts for the Salesforce delivery team — analyse,
          plan, design, execute, and close from a single workspace, grounded in
          your project context.
        </p>
        <Stagger className="flex flex-wrap gap-3 mt-5 relative z-10" delayChildren={0.3} staggerChildren={0.07}>
          {['7 Manual + 9 Advanced Agents', 'STLC End-to-End', 'RAG Grounded', 'Agent Chaining'].map(label => (
            <StaggerItem key={label}>
              <motion.span
                whileHover={{ scale: 1.05, y: -2 }}
                className="inline-block bg-white/10 backdrop-blur px-4 py-1.5 rounded-xl text-sm font-semibold border border-white/20"
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

      {showStlcHero && (
      <Tilt3D max={6} className="mb-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => nav('/stlc-pack')}
          className="cursor-pointer relative overflow-hidden rounded-toon-lg p-6 shadow-astound bg-astound-grad text-white"
          style={{ backgroundSize: '180% 180%' }}
        >
          <div className="relative z-10 flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-md">
              <Icon3D name="stlc_pack" size={42} float tilt />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.2em] font-bold opacity-90">New</div>
              <h3 className="text-xl font-extrabold font-display">1-click STLC Pack</h3>
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
      </Tilt3D>
      )}

      <h2 className="font-display text-lg font-extrabold text-toon-navy mb-4 flex items-center gap-2">
        <span>Workspace</span>
        <span className="flex-1 h-0.5 bg-gradient-to-r from-astound-violet/30 to-transparent rounded" />
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {utilityTiles.map((tile) => (
          <Tilt3D key={tile.path} max={6}>
            <div
              onClick={() => nav(tile.path)}
              className="astound-card-light cursor-pointer h-full transition-transform hover:-translate-y-1"
            >
              <div className="mb-3">
                <Icon3D name={tile.iconKey3d} size={42} float tilt />
              </div>
              <h3 className="font-bold text-toon-navy font-display">{tile.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{tile.desc}</p>
            </div>
          </Tilt3D>
        ))}
      </div>

      {visibleSections.map((section) => (
        <motion.div
          key={section.phase}
          className="mb-10 relative"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-extrabold text-toon-navy flex items-center gap-3">
              <span className={`w-2 h-6 rounded-full bg-gradient-to-b ${section.accent}`} />
              <span>{section.phase}</span>
            </h2>
            <div className="opacity-90 hidden sm:block">
              <Icon3D name={section.iconKey3d} size={36} float />
            </div>
          </div>
          <div className="astound-divider mb-4" />
          <Stagger
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            delayChildren={0.05}
            staggerChildren={0.05}
          >
            {section.tiles.map((tile) => (
              <StaggerItem key={tile.path}>
                <Tilt3D max={8}>
                  <div
                    onClick={() => nav(tile.path)}
                    className="astound-card-light cursor-pointer h-full transition-transform"
                  >
                    <div className="mb-3">
                      <Icon3D name={tile.iconKey3d} size={42} float tilt />
                    </div>
                    <h3 className="font-bold text-toon-navy font-display">{tile.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{tile.desc}</p>
                  </div>
                </Tilt3D>
              </StaggerItem>
            ))}
          </Stagger>
        </motion.div>
      ))}

      {showAdvancedCallout && (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.4 }}
        className="rounded-toon-lg bg-astound-grad-soft border border-astound-violet/20 p-4 flex items-center gap-3 text-sm"
      >
        <span className="w-10 h-10 rounded-xl bg-astound-grad flex items-center justify-center shadow-astound">
          <Icon3D name="sparkles" size={22} float />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-toon-navy">Looking for advanced agents?</div>
          <div className="text-gray-500 text-xs">
            Effort Estimation, Automation Plan, Test Data, RTM, Automation Scripts, UAT, Execution Report, RCA, and the 1-click STLC Pack are available from the sidebar.
          </div>
        </div>
      </motion.div>
      )}
    </div>
  )
}
