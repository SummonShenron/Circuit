// components/PatchyEmptyState.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';

// Parses a single-segment "M x0 y0 C x1 y1, x2 y2, x3 y3" path into its 4 control points.
const parseCubicPath = (path: string): [number, number][] | null => {
  const nums = path.match(/-?\d+\.?\d*/g)?.map(Number);
  if (!nums || nums.length < 8) return null;
  return [
    [nums[0], nums[1]],
    [nums[2], nums[3]],
    [nums[4], nums[5]],
    [nums[6], nums[7]],
  ];
};

// Returns short line segments perpendicular to the arm's curve at a few points along it.
const getArmRibs = (path: string, tValues: number[] = [0.3, 0.55, 0.8], ribHalfLength = 5) => {
  const points = parseCubicPath(path);
  if (!points) return [];
  const [p0, p1, p2, p3] = points;
  return tValues.map((t) => {
    const mt = 1 - t;
    const x = mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0];
    const y = mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1];
    const dx = 3 * mt ** 2 * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t ** 2 * (p3[0] - p2[0]);
    const dy = 3 * mt ** 2 * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t ** 2 * (p3[1] - p2[1]);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      x1: x + nx * ribHalfLength,
      y1: y + ny * ribHalfLength,
      x2: x - nx * ribHalfLength,
      y2: y - ny * ribHalfLength,
    };
  });
};

export type SystemHealth = 'healthy' | 'degraded' | 'unhealthy';
export type IncidentStatus = 
  | 'idle' 
  | 'analyzing' 
  | 'fix_proposed' 
  | 'validating' 
  | 'resolved' 
  | 'alert' 
  | 'analysis_failed'
  | 'adding_block'
  | 'connecting_block'
  | 'thinking'
  | 'execution'
  | 'error'
  | 'assistant'
  | 'export';

interface PatchyEmptyStateProps {
  tab: 'open' | 'resolved';
  activeIncidentsCount?: number;
  systemHealth?: SystemHealth;
  selectedIncident?: { id?: string; status?: string };
  status?: string;
  incidentStatus?: IncidentStatus;
  isAnalyzing?: boolean;
  isResolved?: boolean;
  isAddingBlock?: boolean;
  isConnectingBlock?: boolean;
  isThinking?: boolean;
  isExecuting?: boolean;
  executionNodeId?: string | null;
  hasExecutionError?: boolean;
  isAssistantOpen?: boolean;
  isExporting?: boolean;
  compact?: boolean;
  /** Overrides the default idle hint messages that cycle in the speech bubble. */
  hints?: string[];
  /** Overrides how long Patchy waits before showing the next idle hint. */
  hintIntervalMs?: number;
  /** Called when Patchy (or his idle hint bubble) is clicked. */
  onOpenAssistant?: () => void;
}

const IDLE_HINTS = [
  'Need help connecting blocks?',
  'Try dragging a block onto the canvas!',
  'Click me any time for a hand with your workflow.',
];
const HINT_IDLE_DELAY_MS = 16_000;
const HINT_VISIBLE_MS = 6_000;

export const PatchyEmptyState: React.FC<PatchyEmptyStateProps> = ({ 
  tab, 
  activeIncidentsCount = 0,
  systemHealth = 'healthy',
  selectedIncident,
  status,
  incidentStatus,
  isAnalyzing = false,
  isResolved = false,
  isAddingBlock = false,
  isConnectingBlock = false,
  isThinking = false,
  isExecuting = false,
  executionNodeId = null,
  hasExecutionError = false,
  isAssistantOpen = false,
  isExporting = false,
  compact = false,
  hints,
  hintIntervalMs,
  onOpenAssistant,
}) => {
  const [celebrationDone, setCelebrationDone] = useState(true);
  const [isLaughing, setIsLaughing] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintCycle, setHintCycle] = useState(0);
  const prevStatusRef = useRef<string | null>(null);
  const activeHints = hints && hints.length > 0 ? hints : IDLE_HINTS;
  const idleDelayMs = hintIntervalMs ?? HINT_IDLE_DELAY_MS;

  const hasActiveIncidents = activeIncidentsCount > 0;
  const isSystemDegradedOrUnhealthy = systemHealth === 'degraded' || systemHealth === 'unhealthy';
  const isAllClear = tab === 'open';

  const rawStatus = (
    selectedIncident?.status || 
    status || 
    incidentStatus || 
    ''
  ).toLowerCase();

  const isRawResolved = rawStatus.includes('resolv') || isResolved;
  const isRawFailed = rawStatus.includes('fail') || rawStatus.includes('error');

  const isAnActiveStatus = (s: string | null) => {
    if (!s) return false;
    return s.includes('analyz') || s.includes('fix') || s.includes('validat') || s.includes('proposed') || s.includes('alert') || s.includes('active') || s.includes('open');
  };

  useEffect(() => {
    const prevStatus = prevStatusRef.current;

    if (isAnActiveStatus(prevStatus) && isRawResolved) {
      setCelebrationDone(false);
      const timer = setTimeout(() => {
        setCelebrationDone(true);
      }, 2500);
      
      return () => clearTimeout(timer);
    }

    prevStatusRef.current = rawStatus;
  }, [isRawResolved, rawStatus]);

  const currentStatus: IncidentStatus = useMemo(() => {
    if (isExporting) return 'export';
    if (hasExecutionError) return 'error';
    if (isAssistantOpen) return 'assistant';
    if (isExecuting) return 'execution';
    if (isThinking) return 'thinking';
    if (isAddingBlock || rawStatus.includes('add')) return 'adding_block';
    if (isConnectingBlock || rawStatus.includes('connect')) return 'connecting_block';
    if (isRawResolved && !celebrationDone) return 'resolved';
    if (isRawFailed) return 'analysis_failed';
    if (rawStatus.includes('validat')) return 'validating';
    if (rawStatus.includes('fix') || rawStatus.includes('proposed')) return 'fix_proposed';
    if (rawStatus.includes('analyz') || isAnalyzing) return 'analyzing';
    if (hasActiveIncidents || isSystemDegradedOrUnhealthy) return 'alert';
    return 'idle';
  }, [isExporting, hasExecutionError, isAssistantOpen, isExecuting, isThinking, isAddingBlock, isConnectingBlock, isRawResolved, celebrationDone, isRawFailed, rawStatus, isAnalyzing, hasActiveIncidents, isSystemDegradedOrUnhealthy]);

  useEffect(() => {
    if (currentStatus !== 'idle') {
      setShowHint(false);
      return;
    }

    let hideTimer: ReturnType<typeof setTimeout>;
    const idleTimer = setTimeout(() => {
      setShowHint(true);
      hideTimer = setTimeout(() => {
        setShowHint(false);
        setHintCycle((prev) => (prev + 1) % activeHints.length);
      }, HINT_VISIBLE_MS);
    }, idleDelayMs);

    return () => {
      clearTimeout(idleTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [currentStatus, hintCycle, activeHints.length, idleDelayMs]);

  const handlePoke = () => {
    setShowHint(false);
    onOpenAssistant?.();
    if (isLaughing) return;
    setIsLaughing(true);
    setTimeout(() => {
      setIsLaughing(false);
    }, 1800);
  };

  const getAccentColor = () => {
    if (isLaughing) return '#EC4899';
    switch (currentStatus) {
      case 'execution': return '#38BDF8';
      case 'error': return '#F59E0B';
      case 'assistant': return '#22C55E';
      case 'export': return '#60A5FA';
      case 'adding_block': return '#0EA5E9';
      case 'connecting_block': return '#A855F7';
      case 'resolved': return '#22C55E';
      case 'validating': return '#3B82F6';
      case 'analyzing': return '#EAB308';
      case 'fix_proposed': return '#E07A5F';
      case 'analysis_failed':
      case 'alert': return '#EF4444';
      case 'idle':
      default: return '#34D399';
    }
  };

  const getGlowColor = () => {
    if (isLaughing) return 'rgba(236, 72, 153, 0.35)';
    switch (currentStatus) {
      case 'execution': return 'rgba(56, 189, 248, 0.38)';
      case 'error': return 'rgba(245, 158, 11, 0.42)';
      case 'assistant': return 'rgba(34, 197, 94, 0.34)';
      case 'export': return 'rgba(96, 165, 250, 0.34)';
      case 'adding_block': return 'rgba(14, 165, 233, 0.35)';
      case 'connecting_block': return 'rgba(168, 85, 247, 0.35)';
      case 'resolved': return 'rgba(34, 197, 94, 0.3)';
      case 'validating': return 'rgba(59, 130, 246, 0.25)';
      case 'analyzing': return 'rgba(234, 179, 8, 0.25)';
      case 'fix_proposed': return 'rgba(224, 122, 95, 0.3)';
      case 'analysis_failed':
      case 'alert': return 'rgba(239, 68, 68, 0.25)';
      case 'idle':
      default: return 'rgba(45, 106, 79, 0.2)';
    }
  };

  const getVisorBg = () => {
    if (isLaughing) return '#240a19';
    switch (currentStatus) {
      case 'execution': return '#061A26';
      case 'error': return '#261A06';
      case 'assistant': return '#071A0F';
      case 'export': return '#07162B';
      case 'adding_block': return '#081923';
      case 'connecting_block': return '#160D21';
      case 'resolved': return '#071A0F';
      case 'validating': return '#0A1326';
      case 'analyzing': return '#1A160A';
      case 'fix_proposed': return '#1C110C';
      case 'analysis_failed':
      case 'alert': return '#1C0D11';
      case 'idle':
      default: return '#0F1E17';
    }
  };

  const getVisorBorder = () => {
    if (isLaughing) return '#6b1947';
    switch (currentStatus) {
      case 'execution': return '#38BDF8';
      case 'error': return '#F59E0B';
      case 'assistant': return '#22C55E';
      case 'export': return '#60A5FA';
      case 'adding_block': return '#0EA5E9';
      case 'connecting_block': return '#A855F7';
      case 'resolved': return '#174722';
      case 'validating': return '#1E3A8A';
      case 'analyzing': return '#4a3b10';
      case 'fix_proposed': return '#E07A5F';
      case 'analysis_failed':
      case 'alert': return '#4a151b';
      case 'idle':
      default: return '#2D6A4F';
    }
  };

  const accentColor = getAccentColor();
  const glowColor = getGlowColor();
  const visorBg = getVisorBg();
  const visorBorder = getVisorBorder();
  const executionFocusX = executionNodeId ? 36 + (executionNodeId.length % 2) * 21 : 50;

  const getHeaderTitle = () => {
    if (isLaughing) return 'Hehehe! That tickles!';
    switch (currentStatus) {
      case 'adding_block': return 'Dropping New Block...';
      case 'connecting_block': return 'Connecting Workflow Nodes!';
      case 'resolved': return 'Workflow Deployed!';
      case 'validating': return 'Validating Execution Nodes...';
      case 'analyzing': return 'Patchy is Analyzing Workflows...';
      case 'fix_proposed': return 'Hotfix Block Proposed';
      case 'analysis_failed': return 'Node Pipeline Error';
      case 'alert': return `Workflow Alerts (${activeIncidentsCount})`;
      case 'idle':
      default:
        if (isRawResolved) return 'Workflow Operational!';
        return isAllClear ? 'Workflow Canvas Ready' : 'No Incident Logs';
    }
  };

  const getSubtext = () => {
    if (isLaughing) return 'Need help connecting blocks or configuring triggers?';
    switch (currentStatus) {
      case 'adding_block': return 'Patchy is catching and positioning your new node onto the canvas grid.';
      case 'connecting_block': return 'Linking data payload streams between execution blocks!';
      case 'resolved': return 'Patchy tested the pipeline. All workflow nodes are connected and green!';
      case 'validating': return 'Monitoring payload data across step boundaries for errors.';
      case 'analyzing': return 'Inspecting step configurations and parsing runtime telemetry...';
      case 'fix_proposed': return 'Patchy generated an auto-fix routing node for your review.';
      case 'analysis_failed': return 'Patchy hit an unhandled exception in telemetry. Manual configuration required.';
      case 'alert': return 'Patchy flagged a failing pipeline step. Select an incident to inspect.';
      case 'idle':
      default:
        if (isRawResolved) return 'Patchy verified node execution! Everything is running smoothly.';
        return isAllClear
          ? 'Patchy is standing by and ready to help. Need help connecting blocks?'
          : 'Resolved pipeline alerts will appear here.';
    }
  };

  // Dynamic Arm Path & Hand Transform Coordinates
  const leftArmPath = isLaughing
    ? "M 34 60 C 22 62, 18 70, 22 75"
    : currentStatus === 'adding_block'
    ? "M 34 60 C 20 48, 18 32, 26 20"
    : currentStatus === 'connecting_block'
    ? "M 34 60 C 38 64, 42 66, 45 64"
    : currentStatus === 'resolved'
    ? "M 34 60 C 22 48, 16 34, 20 22"
    : "M 34 60 C 24 62, 18 70, 20 77";

  const leftHandTransform = isLaughing
    ? "translate(22, 75) rotate(35)"
    : currentStatus === 'adding_block'
    ? "translate(26, 20) rotate(-130)"
    : currentStatus === 'connecting_block'
    ? "translate(45, 64) rotate(-110)"
    : currentStatus === 'resolved'
    ? "translate(20, 22) rotate(-140)"
    : "translate(20, 77) rotate(20)";

  const rightArmPath = isLaughing
    ? "M 66 60 C 78 62, 82 70, 78 75"
    : currentStatus === 'adding_block'
    ? "M 66 60 C 80 48, 82 32, 74 20"
    : currentStatus === 'connecting_block'
    ? "M 66 60 C 62 64, 58 66, 55 64"
    : currentStatus === 'resolved'
    ? "M 66 60 C 78 48, 84 34, 80 22"
    : currentStatus === 'analyzing'
    ? "M 66 60 C 80 50, 78 32, 70 26"
    : currentStatus === 'thinking'
    ? "M 66 60 C 75 56, 69 48, 58 46"
    : currentStatus === 'error'
    ? "M 66 60 C 68 52, 62 46, 54 44"
    : "M 66 60 C 76 62, 82 70, 80 77";

  const rightHandTransform = isLaughing
    ? "translate(78, 75) rotate(-35)"
    : currentStatus === 'adding_block'
    ? "translate(74, 20) rotate(130)"
    : currentStatus === 'connecting_block'
    ? "translate(55, 64) rotate(110)"
    : currentStatus === 'resolved'
    ? "translate(80, 22) rotate(140)"
    : currentStatus === 'analyzing'
    ? "translate(70, 26) rotate(-110)"
    : currentStatus === 'thinking'
    ? "translate(57, 48) rotate(-28)"
    : currentStatus === 'error'
    ? "translate(52, 44) rotate(-50)"
    : "translate(80, 77) rotate(-20)";

  const leftArmRibs = useMemo(() => getArmRibs(leftArmPath), [leftArmPath]);
  const rightArmRibs = useMemo(() => getArmRibs(rightArmPath), [rightArmPath]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? 0 : '2.5rem 1rem',
      textAlign: 'center',
    }}>
      <style>{`
        @keyframes ibmFloat {
          0%, 100% { transform: translateY(0px) scale(1, 1); }
          50% { transform: translateY(-8px) scale(0.98, 1.02); }
          75% { transform: translateY(-2px) scale(1.01, 0.99); }
        }

        @keyframes ibmAlertPulse {
          0%, 100% { 
            transform: translateY(0px) scale(1);
            filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.4));
          }
          50% { 
            transform: translateY(-6px) scale(1.04);
            filter: drop-shadow(0 0 16px rgba(239, 68, 68, 0.85));
          }
        }

        @keyframes ibmVictoryJitter {
          0%, 100% { transform: translateY(0px) rotate(0deg) scale(1); }
          15% { transform: translateY(-5px) rotate(-4deg) scale(1.04); }
          30% { transform: translateY(3px) rotate(4deg) scale(0.96); }
          45% { transform: translateY(-4px) rotate(-3deg) scale(1.02); }
          60% { transform: translateY(4px) rotate(3deg) scale(0.98); }
          75% { transform: translateY(-2px) rotate(-4deg) scale(1.03); }
        }

        @keyframes ibmGiggle {
          0%, 100% { transform: translateY(0px) rotate(0deg) scale(1); }
          25% { transform: translateY(-4px) rotate(-3.5deg) scale(1.03, 0.97); }
          50% { transform: translateY(2px) rotate(3.5deg) scale(0.97, 1.03); }
          75% { transform: translateY(-2px) rotate(-2deg) scale(1.01, 0.99); }
        }

        @keyframes ibmBlockCatch {
          0% { transform: translateY(-12px) scale(0.95, 1.05); }
          40% { transform: translateY(4px) scale(1.06, 0.94); }
          70% { transform: translateY(-2px) scale(0.98, 1.02); }
          100% { transform: translateY(0px) scale(1, 1); }
        }

        @keyframes ibmBlockSnapConnect {
          0% { transform: scale(0.92) rotate(0deg); }
          30% { transform: scale(1.08) rotate(-2deg); }
          50% { transform: scale(0.98) rotate(2deg); }
          75% { transform: scale(1.03) rotate(-1deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes ibmFallingBlock {
          0% { transform: translateY(-28px) scale(0.6); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translateY(0px) scale(1); opacity: 1; }
        }

        @keyframes ibmEnergyZap {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        @keyframes ibmHeadTilt {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-5deg); }
          50% { transform: rotate(0deg); }
          75% { transform: rotate(4deg); }
        }

        @keyframes ibmBlink {
          0%, 45%, 52%, 100% { transform: scaleY(1); }
          48% { transform: scaleY(0.08); }
        }

        @keyframes ibmFootKickLeft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px) rotate(-8deg); }
        }

        @keyframes ibmFootKickRight {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px) rotate(8deg); }
        }

        @keyframes ibmExcitedEyes {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-1.5px, 1px); }
          50% { transform: translate(1.5px, -1px); }
          75% { transform: translate(-1px, -1px); }
        }

        @keyframes ibmExecutionPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-4px) scale(1.035); }
        }

        @keyframes ibmAnxiousFootTap {
          0%, 80%, 100% { transform: translateY(0); }
          88% { transform: translateY(-4px); }
          94% { transform: translateY(0); }
        }

        @keyframes ibmAssistantGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(34, 197, 94, .25)); }
          50% { filter: drop-shadow(0 0 13px rgba(34, 197, 94, .72)); }
        }

        @keyframes ibmExportLift {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px) rotate(-2deg); }
        }

        @keyframes ibmLookAtNodes {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }

        @keyframes ibmGearSpin { to { transform: rotate(360deg); } }

        @keyframes ibmSpeechPop {
          0% { opacity: 0; transform: translate(-50%, 8px) scale(.88); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }

        @keyframes ibmThinkingHead {
          0%, 18% { transform: rotate(0deg); }
          32%, 48% { transform: rotate(-10deg); }
          62%, 78% { transform: rotate(7deg); }
          92%, 100% { transform: rotate(0deg); }
        }

        @keyframes ibmGlint {
          0%, 60% { transform: translateX(-50px); opacity: 0; }
          70% { opacity: 0.35; }
          85%, 100% { transform: translateX(60px); opacity: 0; }
        }

        @keyframes ibmHintPop {
          0% { opacity: 0; transform: translateY(8px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ibm-bot-interactive-wrap {
          cursor: pointer;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
          user-select: none;
        }
        .ibm-bot-interactive-wrap:hover {
          transform: scale(1.06);
        }
        .ibm-bot-interactive-wrap:active {
          transform: scale(0.95);
        }

        .ibm-bot-float { 
          animation: ${
            isLaughing
              ? 'ibmGiggle 0.5s ease-in-out infinite'
              : currentStatus === 'adding_block'
              ? 'ibmFloat 4s cubic-bezier(0.45, 0, 0.55, 1) infinite'
              : currentStatus === 'execution'
              ? 'ibmExecutionPulse 0.8s ease-in-out infinite'
              : currentStatus === 'assistant'
              ? 'ibmAssistantGlow 1.8s ease-in-out infinite'
              : currentStatus === 'connecting_block'
              ? 'ibmBlockSnapConnect 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) infinite'
              : currentStatus === 'resolved'
              ? 'ibmVictoryJitter 0.22s ease-in-out infinite'
              : (currentStatus === 'alert' || currentStatus === 'analysis_failed')
              ? 'ibmAlertPulse 1.4s ease-in-out infinite' 
              : 'ibmFloat 4s cubic-bezier(0.45, 0, 0.55, 1) infinite'
          }; 
        }
        .ibm-bot-head { transform-origin: 50px 36px; animation: ${currentStatus === 'thinking' ? 'ibmThinkingHead 3.6s ease-in-out infinite' : currentStatus === 'execution' ? 'ibmLookAtNodes 1.2s ease-in-out infinite' : 'ibmHeadTilt 7s ease-in-out infinite'}; }
        .ibm-bot-eyes { transform-origin: center; transform-box: fill-box; animation: ibmBlink 4.2s infinite; }
        .ibm-bot-eyes.execution-eyes { animation: ibmExcitedEyes .18s linear infinite; filter: drop-shadow(0 0 4px ${accentColor}); }
        .ibm-bot-eyes.error-eyes { animation: ibmBlink 1.4s infinite; filter: drop-shadow(0 0 5px #F59E0B); }
        .ibm-bot-eyes.excited { animation: ibmExcitedEyes 0.12s linear infinite; }
        .ibm-bot-left-foot, .ibm-bot-right-foot { transform-box: fill-box; }
        .ibm-bot-left-foot { transform-origin: 50% 100%; animation: ${currentStatus === 'adding_block' ? 'ibmFootKickLeft 0.24s ease-in-out infinite' : currentStatus === 'error' ? 'ibmAnxiousFootTap 2.6s ease-in-out infinite' : 'none'}; }
        .ibm-bot-right-foot { transform-origin: 50% 100%; animation: ${currentStatus === 'adding_block' ? 'ibmFootKickRight 0.24s ease-in-out 0.12s infinite' : currentStatus === 'error' ? 'ibmAnxiousFootTap 2.6s ease-in-out 0.15s infinite' : 'none'}; }
        .ibm-bot-glint { animation: ibmGlint 4s ease-in-out infinite; }
        .ibm-falling-node { animation: ibmFallingBlock 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .ibm-energy-zap { animation: ibmEnergyZap 0.3s ease-in-out infinite; }
        .ibm-gear { transform-origin: 50% 50%; animation: ibmGearSpin .8s linear infinite; }
        .ibm-export-file { animation: ibmExportLift 1s ease-in-out infinite; transform-origin: 50% 50%; }
      `}</style>

      <div 
        className="ibm-bot-interactive-wrap"
        onClick={handlePoke}
        title="Click Patchy!"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handlePoke()}
        style={{ 
          position: 'relative',
          width: compact ? '104px' : '150px', 
          height: compact ? '104px' : '150px', 
          marginBottom: compact ? 0 : '1rem' 
        }}
      >
        {currentStatus === 'error' && (
          <div style={{ position: 'absolute', bottom: '106%', left: '50%', width: '190px', padding: '7px 10px', color: '#FFF7ED', background: '#3A1F08', border: '1px solid #F59E0B', borderRadius: '8px', fontSize: '10px', lineHeight: 1.3, boxShadow: '0 4px 14px rgba(0,0,0,.25)', animation: 'ibmSpeechPop .25s ease-out forwards', zIndex: 20 }}>
            Something broke - want me to help debug?
          </div>
        )}
        {currentStatus === 'assistant' && (
          <div style={{ position: 'absolute', bottom: '106%', left: '50%', width: '170px', padding: '7px 10px', color: '#ECFDF5', background: '#0F2A1D', border: '1px solid #22C55E', borderRadius: '8px', fontSize: '10px', lineHeight: 1.3, boxShadow: '0 4px 14px rgba(0,0,0,.25)', animation: 'ibmSpeechPop .25s ease-out forwards', zIndex: 20 }}>
            I am ready to help build and explain this workflow.
          </div>
        )}
        {/* Animated Idle Speech Bubble Nudge */}
        {showHint && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              handlePoke();
            }}
            style={{
              position: 'absolute',
              bottom: compact ? '108%' : '102%',
              right: 0,
              maxWidth: '230px',
              width: 'max-content',
              backgroundColor: '#0F1E17',
              border: `1px solid ${accentColor}`,
              borderRadius: '8px',
              padding: '6px 12px',
              color: '#E6F1ED',
              fontSize: '0.78rem',
              fontWeight: 500,
              lineHeight: 1.4,
              whiteSpace: 'normal',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
              cursor: 'pointer',
              zIndex: 20,
              animation: 'ibmHintPop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
            }}
          >
            {activeHints[hintCycle % activeHints.length]}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: '18px',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: `5px solid ${accentColor}`,
              }}
            />
          </div>
        )}

        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          width="100%"
          height="100%"
        >
          <defs>
            <clipPath id="visor-screen-clip">
              <rect x="28" y="27" width="44" height="22" rx="6" />
            </clipPath>
          </defs>

          {/* Main Floating Body Group */}
          <g className="ibm-bot-float">
            {/* Backdrop Glow */}
            <circle cx="50" cy="50" r="40" fill={glowColor} />

            {/* OVERLAY ANIMATION 1: Floating Block Payload (When Adding Block) */}
            {currentStatus === 'adding_block' && (
              <g transform="translate(38, 12)">
                <g className="ibm-falling-node">
                  <rect x="0" y="0" width="24" height="16" rx="4" fill="#0EA5E9" stroke="#E6F1ED" strokeWidth="1.5" />
                  <rect x="4" y="4" width="8" height="3" rx="1" fill="#FFFFFF" opacity="0.8" />
                  <circle cx="18" cy="11" r="2" fill="#FFFFFF" />
                </g>
              </g>
            )}

            {/* OVERLAY ANIMATION 2: Energy Zap Spark (When Connecting Blocks) */}
            {currentStatus === 'connecting_block' && (
              <g className="ibm-energy-zap" transform="translate(50, 64)">
                <circle cx="0" cy="0" r="8" fill="#A855F7" opacity="0.4" />
                <path d="M -3 -5 L 1 -1 L -1 1 L 4 5 L 0 1 L 2 -1 Z" fill="#FFFFFF" />
              </g>
            )}

            {currentStatus === 'execution' && (
              <g>
                <circle cx={executionFocusX} cy="17" r="2.2" fill="#38BDF8" opacity=".9" />
                <path d={`M ${executionFocusX - 4} 17 H ${executionFocusX + 4}`} stroke="#38BDF8" strokeWidth=".8" opacity=".7" />
              </g>
            )}

            {currentStatus === 'execution' && (
              <g className="ibm-gear" transform="translate(79, 61)">
                <circle r="6" fill="#38BDF8" opacity=".22" />
                <path d="M0 -9 L2 -6 L6 -7 L7 -3 L10 -1 L7 2 L8 6 L4 7 L2 10 L-1 7 L-5 8 L-6 4 L-9 2 L-7 -2 L-8 -6 L-4 -7 L-2 -10 Z" fill="#38BDF8" opacity=".9" />
                <circle r="2" fill="#061A26" />
              </g>
            )}

            {currentStatus === 'export' && (
              <g className="ibm-export-file" transform="translate(76, 52) rotate(12)">
                <path d="M0 0 H12 L18 6 V25 H0 Z" fill="#60A5FA" stroke="#DBEAFE" strokeWidth="1.2" />
                <path d="M12 0 V7 H18" fill="none" stroke="#DBEAFE" strokeWidth="1.2" />
                <path d="M4 13 H14 M4 18 H14" stroke="#0F2A4A" strokeWidth="1.2" strokeLinecap="round" />
              </g>
            )}

            {/* Chunky Feet / Boots */}
            <g className="ibm-bot-left-foot">
              <rect x="30" y="81" width="15" height="9" rx="3.5" fill="#16281E" stroke="#0F1E17" strokeWidth="1.5" />
              <rect x="32" y="86" width="11" height="3" rx="1" fill="#E07A5F" opacity="0.8" />
            </g>
            <g className="ibm-bot-right-foot">
              <rect x="55" y="81" width="15" height="9" rx="3.5" fill="#16281E" stroke="#0F1E17" strokeWidth="1.5" />
              <rect x="57" y="86" width="11" height="3" rx="1" fill="#E07A5F" opacity="0.8" />
            </g>

            {/* Leg Posts */}
            <rect x="35" y="75" width="5" height="7" rx="1.5" fill="#2D6A4F" stroke="#16281E" strokeWidth="1" />
            <rect x="60" y="75" width="5" height="7" rx="1.5" fill="#2D6A4F" stroke="#16281E" strokeWidth="1" />

            {/* Slimmer Torso Chassis */}
            <rect x="34" y="53" width="32" height="25" rx="7" fill="#C2D6CE" stroke="#2D6A4F" strokeWidth="2" />
            
            {/* Terracotta Orange Harness Collar Trim */}
            <path d="M 34 56 C 40 53, 60 53, 66 56 L 66 62 C 60 58, 40 58, 34 62 Z" fill="#E07A5F" stroke="#C85A3F" strokeWidth="1" />

            {/* Dark Forest Chest Panel */}
            <rect x="42" y="62" width="16" height="11" rx="3" fill="#0F1E17" stroke="#2D6A4F" strokeWidth="1.2" />
            <circle cx="47" cy="67.5" r="2" fill={accentColor} />
            <circle cx="53" cy="67.5" r="2" fill="#E07A5F" />

            {/* LEFT ARM */}
            <g>
              <path d={leftArmPath} stroke="#2D6A4F" strokeWidth="11" strokeLinecap="round" fill="none" />
              <path d={leftArmPath} stroke="#C2D6CE" strokeWidth="8" strokeLinecap="round" fill="none" />
              {leftArmRibs.map((rib, index) => (
                <line
                  key={index}
                  x1={rib.x1}
                  y1={rib.y1}
                  x2={rib.x2}
                  y2={rib.y2}
                  stroke="#2D6A4F"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              ))}
            </g>

            {/* LEFT LEGO C-CLAMP HAND */}
            <g transform={leftHandTransform}>
              <rect x="-4" y="-2" width="8" height="4" rx="1.5" fill="#16281E" stroke="#0F1E17" strokeWidth="0.8" />
              <path
                d="M -2 0 H 2 V 3 C 6 3, 9 6, 8 11 C 7 15, 3 15, 2 12 C 3 9, 5 8, 3 6 C 1 5, -1 5, -3 6 C -5 8, -3 9, -2 12 C -3 15, -7 15, -8 11 C -9 6, -6 3, -2 3 Z"
                fill="#E07A5F"
                stroke="#B85338"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </g>

            {/* RIGHT ARM */}
            <g>
              <path d={rightArmPath} stroke="#2D6A4F" strokeWidth="11" strokeLinecap="round" fill="none" />
              <path d={rightArmPath} stroke="#C2D6CE" strokeWidth="8" strokeLinecap="round" fill="none" />
              {rightArmRibs.map((rib, index) => (
                <line
                  key={index}
                  x1={rib.x1}
                  y1={rib.y1}
                  x2={rib.x2}
                  y2={rib.y2}
                  stroke="#2D6A4F"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              ))}
            </g>

            {/* HEAD GROUP */}
            <g className="ibm-bot-head">
              <path d="M 50 20 L 50 11" stroke="#2D6A4F" strokeWidth="4" strokeLinecap="round" fill="none" />
              <path d="M 50 20 L 50 11" stroke="#E07A5F" strokeWidth="2" strokeLinecap="round" fill="none" />
              <circle cx="50" cy="8" r="4" fill="#E07A5F" stroke="#2D6A4F" strokeWidth="1.5" />
              <circle cx="48.7" cy="6.7" r="1" fill="#FDE8D8" />

              <line x1="18" y1="36" x2="24" y2="36" stroke="#2D6A4F" strokeWidth="3" strokeLinecap="round" />
              <line x1="76" y1="36" x2="82" y2="36" stroke="#2D6A4F" strokeWidth="3" strokeLinecap="round" />

              <rect x="22" y="20" width="56" height="32" rx="10" fill="#E6F1ED" stroke="#2D6A4F" strokeWidth="2" />
              
              <path d="M 26 24 C 38 21, 62 21, 74 24" stroke="#E07A5F" strokeWidth="2.5" strokeLinecap="round" fill="none" />

              <g>
                <rect x="28" y="27" width="44" height="22" rx="6" fill={visorBg} stroke={visorBorder} strokeWidth="2" />
                <g clipPath="url(#visor-screen-clip)">
                  <path d="M24 20 L28 20 L22 52 L18 52 Z" fill="#FFFFFF" className="ibm-bot-glint" />
                </g>
              </g>

              {/* Visor Eyes & Custom State Graphics */}
              {isLaughing ? (
                <g stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" fill="none">
                  <path d="M 36 38 Q 41 31 46 38" />
                  <path d="M 54 38 Q 59 31 64 38" />
                </g>
              ) : currentStatus === 'adding_block' ? (
                <g className="ibm-bot-eyes">
                  <rect x="36" y="31" width="7" height="11" rx="2.5" fill={accentColor} />
                  <rect x="57" y="31" width="7" height="11" rx="2.5" fill={accentColor} />
                </g>
              ) : currentStatus === 'connecting_block' ? (
                <g className="ibm-bot-eyes excited" fill={accentColor}>
                  <rect x="36" y="33" width="7" height="9" rx="2.5" />
                  <rect x="57" y="33" width="7" height="9" rx="2.5" />
                </g>
              ) : (
                <g className={`ibm-bot-eyes ${currentStatus === 'execution' ? 'execution-eyes' : currentStatus === 'error' ? 'error-eyes' : ''}`}>
                  <rect x="36" y="33" width="7" height="9" rx="2.5" fill={accentColor} />
                  <rect x="57" y="33" width="7" height="9" rx="2.5" fill={accentColor} />
                </g>
              )}
              {currentStatus === 'connecting_block' && (
                <g stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <path d="M 36 38 L 42 34 L 40 40 L 45 36" />
                  <path d="M 55 38 L 61 34 L 59 40 L 64 36" />
                </g>
              )}

              {/* Visor Mouth Expression Accent */}
              {isLaughing ? (
                <path d="M 44 43 Q 50 48 56 43 Z" fill={accentColor} opacity="0.9" />
              ) : (currentStatus === 'resolved' || currentStatus === 'adding_block' || currentStatus === 'connecting_block') ? (
                <path d="M 43 43 Q 50 48 57 43" stroke={accentColor} strokeWidth="2" strokeLinecap="round" fill="none" />
              ) : (currentStatus === 'alert' || currentStatus === 'analysis_failed') ? (
                <path d="M 44 45 Q 50 41 56 45" stroke={accentColor} strokeWidth="2" strokeLinecap="round" fill="none" />
              ) : null}
            </g>

            {/* Render the thinking hand after the head so it rests visibly at the chin. */}
            <g transform={rightHandTransform}>
              <rect x="-4" y="-2" width="8" height="4" rx="1.5" fill="#16281E" stroke="#0F1E17" strokeWidth="0.8" />
              <path
                d="M -2 0 H 2 V 3 C 6 3, 9 6, 8 11 C 7 15, 3 15, 2 12 C 3 9, 5 8, 3 6 C 1 5, -1 5, -3 6 C -5 8, -3 9, -2 12 C -3 15, -7 15, -8 11 C -9 6, -6 3, -2 3 Z"
                fill="#E07A5F"
                stroke="#B85338"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </g>
          </g>
        </svg>
      </div>

      {!compact && <h3 style={{ margin: '0 0 0.35rem 0', color: accentColor, fontSize: '1.1rem', fontWeight: 700 }}>
        {getHeaderTitle()}
      </h3>}
      {!compact && <p className="muted" style={{ margin: 0, maxWidth: '280px', fontSize: '0.85rem' }}>
        {getSubtext()}
      </p>}
    </div>
  );
};