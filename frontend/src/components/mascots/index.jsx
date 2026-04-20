import RequirementMascot from './RequirementMascot'
import PlanningMascot from './PlanningMascot'
import DesignMascot from './DesignMascot'
import ExecutionMascot from './ExecutionMascot'
import ClosureMascot from './ClosureMascot'

export const MASCOTS = {
  RequirementMascot,
  PlanningMascot,
  DesignMascot,
  ExecutionMascot,
  ClosureMascot,
}

export function Mascot({ name, size = 64 }) {
  const Comp = MASCOTS[name]
  if (!Comp) return null
  return <Comp size={size} />
}

export {
  RequirementMascot,
  PlanningMascot,
  DesignMascot,
  ExecutionMascot,
  ClosureMascot,
}
